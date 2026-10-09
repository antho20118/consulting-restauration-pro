import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Chantier F09/F10 — PR H : POST /listings-fournisseur/documents/:documentId/valider ne validait
// pas la structure de `decisions` (voir le rapport d'audit de réconciliation du 2026-10-08, RED
// #1) : un élément non-objet/null crashait en 500, et — plus grave — le design par transaction
// indépendante par décision + mise à jour du document en fin de boucle laissait les décisions
// déjà traitées committées malgré l'échec global de la requête, le document restant EN_ATTENTE
// alors qu'une de ses lignes avait déjà changé d'état.
//
// Correctif : validation Zod minimale de la forme de `decisions` (seul `ligneId`, le champ
// directement exploité par un accès Prisma, est typé — `decision`/`articleRetenuId` gardent
// exactement leur tolérance actuelle, voir le commentaire dans listingsFournisseur.ts) + une
// unique transaction englobant toute la boucle ET la mise à jour finale du statut du document.

let server: Server;
let baseUrl: string;
let token: string;
let dossierTemporaire: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
const articleIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

before(async () => {
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "validation-decisions-listing-"));
  process.env.DOCUMENTS_STORAGE_PATH = dossierTemporaire;

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  token = await connecterAdminDeTest(baseUrl);

  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie =
    (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ??
    (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  if (!(await prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } }))) {
    await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } });
  }
  if (!(await prisma.conditionnement.findFirst())) {
    await prisma.conditionnement.create({ data: { nom: "Carton" } });
  }

  const fournisseur = await prisma.fournisseur.create({
    data: { nom: `VALIDATION DECISIONS TEST Fournisseur ${randomUUID()}`, societeId },
  });
  fournisseurId = fournisseur.id;
});

after(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.produitFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.aliasIngredientImport.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
  delete process.env.DOCUMENTS_STORAGE_PATH;
  await fs.rm(dossierTemporaire, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function creerArticleAvecTarif(nom: string, prixHT: number) {
  const unite = await prisma.unite.findFirstOrThrow({ where: { symbole: { equals: "kg", mode: "insensitive" } } });
  const conditionnement = await prisma.conditionnement.findFirstOrThrow();
  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom, categorieId, tvaId, societeId },
  });
  articleIds.push(article.id);
  await prisma.tarifArticle.create({
    data: { articleId: article.id, fournisseurId, uniteId: unite.id, conditionnementId: conditionnement.id, quantiteConditionnement: 1, prixHT },
  });
  return article;
}

// Patch confiné aux tests, restauré systématiquement — même mécanisme validé dans le chantier
// atomicité des imports (atomiciteImportsTransaction.test.ts) : intercepte `prisma.$transaction`
// pour patcher le `tx` réel fourni au callback de production, afin de provoquer une panne
// déterministe sur le Nième `tarifArticle.create` DANS la transaction de production elle-même.
function armerPanneSurTarifCreate(indexCrashant: number): () => void {
  let compteur = 0;
  const originalTransaction = prisma.$transaction.bind(prisma);
  (prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = (async (
    arg: unknown,
    ...reste: unknown[]
  ) => {
    if (typeof arg !== "function") {
      return (originalTransaction as (...a: unknown[]) => unknown)(arg, ...reste);
    }
    return (originalTransaction as (...a: unknown[]) => unknown)(async (tx: unknown) => {
      const txTarif = (tx as { tarifArticle: { create: (...args: unknown[]) => Promise<unknown> } }).tarifArticle;
      const originalCreate = txTarif.create.bind(txTarif);
      txTarif.create = async (...args: unknown[]) => {
        compteur++;
        if (compteur === indexCrashant) {
          throw new Error("PANNE SIMULÉE (test d'atomicité) : échec déterministe confiné aux tests, jamais une panne réelle");
        }
        return originalCreate(...args);
      };
      return (arg as (tx: unknown) => unknown)(tx);
    }, ...reste);
  }) as typeof prisma.$transaction;

  return () => {
    (prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = originalTransaction;
  };
}

test("GREEN : decisions:[null] -> 400 avant toute écriture", async () => {
  const article = await creerArticleAvecTarif(`GREEN Article Seul ${randomUUID()}`, 10);
  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ societeId, photoDataUrl: PNG_1X1, lignes: [{ designation: article.nom, prix: "12,00" }] }),
  });
  const { document } = await reponseCreation.json();

  const tarifsAvant = await prisma.tarifArticle.count({ where: { articleId: article.id } });
  const documentAvant = await prisma.documentFournisseur.findUniqueOrThrow({ where: { id: document.id } });

  const reponseValidation = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decisions: [null] }),
  });

  assert.equal(reponseValidation.status, 400);
  const corps = await reponseValidation.json();
  assert.equal(corps.error, "Décisions invalides");

  assert.equal(await prisma.tarifArticle.count({ where: { articleId: article.id } }), tarifsAvant);
  const documentApres = await prisma.documentFournisseur.findUniqueOrThrow({ where: { id: document.id } });
  assert.equal(documentApres.statut, documentAvant.statut);
});

test("GREEN : decisions:[decisionValide, null] -> 400 avant toute écriture, aucune décision partielle", async () => {
  const articleValide = await creerArticleAvecTarif(`GREEN Article Valide ${randomUUID()}`, 10);

  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ societeId, photoDataUrl: PNG_1X1, lignes: [{ designation: articleValide.nom, prix: "30,00" }] }),
  });
  const { document, lignes } = await reponseCreation.json();
  const ligneValide = lignes[0];
  assert.equal(ligneValide.articleProposeId, articleValide.id, "pré-condition : la ligne doit proposer l'article attendu");

  const tarifsAvant = await prisma.tarifArticle.count({ where: { articleId: articleValide.id } });

  const reponseValidation = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      decisions: [{ ligneId: ligneValide.id, decision: "VALIDEE", articleRetenuId: articleValide.id }, null],
    }),
  });

  assert.equal(reponseValidation.status, 400, "la requête entière doit être rejetée avant tout traitement");

  assert.equal(
    await prisma.tarifArticle.count({ where: { articleId: articleValide.id } }),
    tarifsAvant,
    "aucun TarifArticle ne doit être créé : la décision valide ne doit plus être traitée isolément"
  );
  const ligneRelue = await prisma.ligneDocumentFournisseur.findUniqueOrThrow({ where: { id: ligneValide.id } });
  assert.equal(ligneRelue.decision, "EN_ATTENTE", "la ligne valide ne doit pas avoir changé d'état");
  assert.equal(ligneRelue.tarifCreeId, null);

  const documentApres = await prisma.documentFournisseur.findUniqueOrThrow({ where: { id: document.id } });
  assert.equal(documentApres.statut, "EN_ATTENTE");
});

test("GREEN : payload valide existant garde exactement son comportement (régression)", async () => {
  const article = await creerArticleAvecTarif(`GREEN Article Regression ${randomUUID()}`, 20);
  const ancienTarif = await prisma.tarifArticle.findFirstOrThrow({ where: { articleId: article.id, actif: true } });

  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ societeId, photoDataUrl: PNG_1X1, lignes: [{ designation: article.nom, prix: "25,00" }] }),
  });
  const { document, lignes } = await reponseCreation.json();
  const ligne = lignes[0];

  const reponseValidation = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decisions: [{ ligneId: ligne.id, decision: "VALIDEE", articleRetenuId: article.id }] }),
  });
  assert.equal(reponseValidation.status, 200);
  const resultat = await reponseValidation.json();
  assert.equal(resultat.valides, 1);
  assert.equal(resultat.refusees.length, 0);

  const ancienRelu = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: ancienTarif.id } });
  assert.equal(ancienRelu.actif, false);

  const ligneRelue = await prisma.ligneDocumentFournisseur.findUniqueOrThrow({ where: { id: ligne.id } });
  assert.equal(ligneRelue.decision, "VALIDEE");
  assert.equal(ligneRelue.articleRetenuId, article.id);
  assert.ok(ligneRelue.tarifCreeId);

  const documentApres = await prisma.documentFournisseur.findUniqueOrThrow({ where: { id: document.id } });
  assert.equal(documentApres.statut, "VALIDE");
});

test("GREEN : decision inconnue (ni VALIDEE ni REJETEE) garde son comportement actuel (tentative VALIDEE, refusée faute d'articleRetenuId conforme)", async () => {
  const article = await creerArticleAvecTarif(`GREEN Article Decision Inconnue ${randomUUID()}`, 10);
  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ societeId, photoDataUrl: PNG_1X1, lignes: [{ designation: article.nom, prix: "10,00" }] }),
  });
  const { document, lignes } = await reponseCreation.json();
  const ligne = lignes[0];

  const tarifsAvant = await prisma.tarifArticle.count({ where: { articleId: article.id } });
  const reponseValidation = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decisions: [{ ligneId: ligne.id, decision: "AUTRE_CHOSE" }] }),
  });
  assert.equal(reponseValidation.status, 200, "une valeur de decision inconnue ne doit pas être rejetée en 400 par la validation structurelle");
  const resultat = await reponseValidation.json();
  assert.equal(resultat.valides, 0);
  assert.equal(resultat.refusees.length, 1, "refusée métier (articleRetenuId manquant), comme avant ce correctif");
  assert.equal(await prisma.tarifArticle.count({ where: { articleId: article.id } }), tarifsAvant);
});

test("GREEN : panne DB réelle sur la 2e décision -> rollback complet (y compris la 1ère décision valide), jamais maquillée en 400", async () => {
  const article1 = await creerArticleAvecTarif(`GREEN Article Atomicite 1 ${randomUUID()}`, 10);
  const article2 = await creerArticleAvecTarif(`GREEN Article Atomicite 2 ${randomUUID()}`, 20);

  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      photoDataUrl: PNG_1X1,
      lignes: [
        { designation: article1.nom, prix: "10,00" },
        { designation: article2.nom, prix: "20,00" },
      ],
    }),
  });
  const { document, lignes } = await reponseCreation.json();
  assert.equal(lignes.length, 2);
  const ligne1 = lignes.find((l: { articleProposeId: number }) => l.articleProposeId === article1.id);
  const ligne2 = lignes.find((l: { articleProposeId: number }) => l.articleProposeId === article2.id);

  const tarifsAvant1 = await prisma.tarifArticle.count({ where: { articleId: article1.id } });
  const tarifsAvant2 = await prisma.tarifArticle.count({ where: { articleId: article2.id } });

  // Panne déterministe sur le 2e appel réel à tarifArticle.create dans LA MÊME transaction de
  // production (le 1er appel, pour ligne1, doit réussir avant que le 2e échoue).
  const restaurer = armerPanneSurTarifCreate(2);
  let statut: number;
  try {
    const reponseValidation = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        decisions: [
          { ligneId: ligne1.id, decision: "VALIDEE", articleRetenuId: article1.id },
          { ligneId: ligne2.id, decision: "VALIDEE", articleRetenuId: article2.id },
        ],
      }),
    });
    statut = reponseValidation.status;
  } finally {
    restaurer();
  }

  assert.equal(statut, 500, "une panne DB/interne réelle ne doit jamais être maquillée en 400");

  // --- Preuve que l'atomicité globale (pas seulement [null]) est maintenant garantie ---
  assert.equal(
    await prisma.tarifArticle.count({ where: { articleId: article1.id } }),
    tarifsAvant1,
    "la 1ère décision (valide, traitée avec succès avant la panne) ne doit plus survivre : rollback complet"
  );
  assert.equal(await prisma.tarifArticle.count({ where: { articleId: article2.id } }), tarifsAvant2);

  const ligne1Relue = await prisma.ligneDocumentFournisseur.findUniqueOrThrow({ where: { id: ligne1.id } });
  assert.equal(ligne1Relue.decision, "EN_ATTENTE", "la ligne 1 ne doit pas rester VALIDEE après le rollback");

  const documentApres = await prisma.documentFournisseur.findUniqueOrThrow({ where: { id: document.id } });
  assert.equal(documentApres.statut, "EN_ATTENTE");
});

test("GREEN : isolation société — document d'une autre société -> 404, rien n'est modifié", async () => {
  const autreSociete = await prisma.societe.create({ data: { nom: `GREEN Autre Societe ${randomUUID()}` } });
  const autreFournisseur = await prisma.fournisseur.create({
    data: { nom: `GREEN Autre Fournisseur ${randomUUID()}`, societeId: autreSociete.id },
  });
  const autreDocument = await prisma.documentFournisseur.create({
    data: {
      fournisseurId: autreFournisseur.id,
      type: "LISTING",
      statut: "EN_ATTENTE",
      cle: `isolation-${randomUUID()}`,
      typeMime: "image/png",
      tailleOctets: 1,
    },
  });

  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${autreDocument.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decisions: [{ ligneId: 1, decision: "REJETEE" }] }),
  });
  assert.equal(reponse.status, 404);

  const relu = await prisma.documentFournisseur.findUniqueOrThrow({ where: { id: autreDocument.id } });
  assert.equal(relu.statut, "EN_ATTENTE");

  await prisma.documentFournisseur.delete({ where: { id: autreDocument.id } });
  await prisma.fournisseur.delete({ where: { id: autreFournisseur.id } });
  await prisma.societe.delete({ where: { id: autreSociete.id } });
});

test("GREEN : aucune autre donnée non liée n'est modifiée par un rejet 400 (contrôle négatif)", async () => {
  const articleTemoin = await creerArticleAvecTarif(`GREEN Article Temoin ${randomUUID()}`, 7);
  const tarifTemoinAvant = await prisma.tarifArticle.findFirstOrThrow({ where: { articleId: articleTemoin.id } });

  const articleCible = await creerArticleAvecTarif(`GREEN Article Cible Crash ${randomUUID()}`, 15);
  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ societeId, photoDataUrl: PNG_1X1, lignes: [{ designation: articleCible.nom, prix: "15,00" }] }),
  });
  const { document } = await reponseCreation.json();

  const reponseValidation = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decisions: [null] }),
  });
  assert.equal(reponseValidation.status, 400);

  const tarifTemoinApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifTemoinAvant.id } });
  assert.deepEqual(tarifTemoinApres, tarifTemoinAvant);
});
