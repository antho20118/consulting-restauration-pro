import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Test d'intégration réel (vrai serveur Express, vrai Postgres, vrai fichier sur disque) de la
// Phase 4 — import listing photo. Aucune clé ANTHROPIC_API_KEY n'est configurée dans cet
// environnement (vérifié : `env | grep -i anthropic` ne la liste pas) : /import-ia est donc testée
// dans son vrai état "non configuré" (503), pas simulée.

let server: Server;
let baseUrl: string;
let token: string;
let dossierTemporaire: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
const articleIds: number[] = [];
const documentIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

before(async () => {
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "listings-fournisseur-test-"));
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
    (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const uniteKgExistante = await prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } });
  if (!uniteKgExistante) {
    await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } });
  }
  const conditionnementExistant = await prisma.conditionnement.findFirst();
  if (!conditionnementExistant) {
    await prisma.conditionnement.create({ data: { nom: "Carton" } });
  }

  const fournisseur = await prisma.fournisseur.create({
    data: { nom: "LISTING PHOTO TEST Fournisseur", societeId },
  });
  fournisseurId = fournisseur.id;
});

after(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIds } } });
  // Après les TarifArticle (qui peuvent y référer via produitFournisseurId), avant le fournisseur
  // (dont ProduitFournisseur dépend via sa propre FK) — voir la Phase de correctif « apprendre le
  // code produit fournisseur d'un import à l'autre ».
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

async function creerArticleAvecTarif(nom: string, reference: string | null, prixHT: number) {
  const unite = await prisma.unite.findFirstOrThrow({ where: { symbole: { equals: "kg", mode: "insensitive" } } });
  const conditionnement = await prisma.conditionnement.findFirstOrThrow();
  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom, reference, categorieId, tvaId, societeId },
  });
  articleIds.push(article.id);
  await prisma.tarifArticle.create({
    data: {
      articleId: article.id,
      fournisseurId,
      uniteId: unite.id,
      conditionnementId: conditionnement.id,
      quantiteConditionnement: 1,
      prixHT,
    },
  });
  return article;
}

// --- Extraction (vision IA) ---

test("POST /import-ia : 503 quand ANTHROPIC_API_KEY n'est pas configurée (état réel de cet environnement)", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/import-ia`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ photoDataUrl: PNG_1X1 }),
  });
  assert.equal(reponse.status, 503);
});

test("POST /import-ia : 400 sans photo", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/import-ia`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  assert.equal(reponse.status, 400);
});

// --- Persistance du document + rapprochement ---

test("crée un DocumentFournisseur(LISTING) et ses lignes niveau A+B, sans toucher à TarifArticle", async () => {
  const articleReference = await creerArticleAvecTarif("LISTING PHOTO TEST Article Référencé", "REF-42", 10);
  const articleAlias = await creerArticleAvecTarif("LISTING PHOTO TEST Persil Plat Botte", null, 2);
  await prisma.aliasIngredientImport.create({
    data: { texteNormalise: "persil frise", articleId: articleAlias.id },
  });
  // Noms courts délibérément (sans préfixe "LISTING PHOTO TEST") : un préfixe commun à toutes les
  // fixtures diluerait le score Jaccard (voir MOTS_VIDES, importListing.ts — "listing"/"photo"/
  // "test" comptent comme des tokens à part entière, pas des mots vides) et ferait tomber ce
  // couple sous le seuil 0.6, invalidant le scénario "plusieurs candidats" — score vérifié
  // indépendamment à 0.667 pour les deux avant d'écrire ce test.
  await creerArticleAvecTarif("Filet Colin Sauvage Nature", null, 8);
  await creerArticleAvecTarif("Filet Colin Sauvage Fume", null, 9);

  // Compte scopé aux seuls articles créés par ce fichier de test (jamais un compte global de la
  // table, qui course avec d'autres fichiers de test s'exécutant en parallèle sur la même base
  // réelle — voir la fragilité de concurrence déjà caractérisée ailleurs dans ce projet, ex.
  // erreursEcritureFK.test.ts, sur le même principe de comptages non filtrés).
  const tarifsAvant = await prisma.tarifArticle.count({ where: { articleId: { in: articleIds } } });

  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      nomFichierOriginal: "listing.png",
      photoDataUrl: PNG_1X1,
      lignes: [
        { designation: "Peu importe", reference: "REF-42", prix: "10,00" }, // certaine (référence)
        { designation: "PERSIL FRISE", prix: "2,50" }, // certaine (alias)
        { designation: "Filet Colin Sauvage", prix: "9,00" }, // plusieurs candidats
        { designation: "Produit totalement inconnu XYZ", prix: "3,00" }, // aucun candidat
        { designation: "Frais de livraison", prix: "15,00" }, // nature != ARTICLE
      ],
    }),
  });

  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  documentIds.push(corps.document.id);

  assert.equal(corps.document.type, "LISTING");
  assert.equal(corps.document.statut, "EN_ATTENTE");
  assert.match(corps.document.cle, /^[0-9a-f-]{36}$/);
  // Aucune trace de contenu binaire/base64 dans la ligne persistée renvoyée.
  assert.equal(Object.prototype.hasOwnProperty.call(corps.document, "photo"), false);
  assert.equal(JSON.stringify(corps.document).includes("base64"), false);

  assert.equal(corps.lignes.length, 5);
  const [certaineRef, certaineAlias, plusieurs, aucun, livraison] = corps.lignes;

  assert.equal(certaineRef.articleProposeId, articleReference.id);
  assert.equal(certaineRef.confiance, 1);
  assert.equal(certaineRef.motifCorrespondance, "REFERENCE_FOURNISSEUR");
  assert.equal(certaineRef.decision, "EN_ATTENTE");
  assert.equal(certaineRef.tarifCreeId, null);

  assert.equal(certaineAlias.articleProposeId, articleAlias.id);
  assert.equal(certaineAlias.motifCorrespondance, "ALIAS");

  assert.equal(plusieurs.articleProposeId, null);
  assert.equal(Array.isArray(plusieurs.candidatsAlternatifs), true);
  assert.equal(plusieurs.candidatsAlternatifs.length, 2);

  assert.equal(aucun.articleProposeId, null);
  assert.equal(aucun.candidatsAlternatifs, null);

  assert.equal(livraison.natureLigne, "FRAIS_LIVRAISON");
  assert.equal(livraison.articleProposeId, null);

  // Sécurité : aucun TarifArticle créé par cette seule étape (niveau B uniquement).
  const tarifsApres = await prisma.tarifArticle.count({ where: { articleId: { in: articleIds } } });
  assert.equal(tarifsApres, tarifsAvant);

  // Le document original est réellement accessible via la route Phase 1, avec les bons octets.
  const reponseFichier = await fetch(
    `${baseUrl}/api/documents-fournisseurs/${fournisseurId}/${corps.document.cle}`,
    { headers: authHeaders() }
  );
  assert.equal(reponseFichier.status, 200);
  const octets = Buffer.from(await reponseFichier.arrayBuffer());
  assert.equal(octets.equals(Buffer.from(PNG_1X1.split(",")[1], "base64")), true);
});

test("rejette un fichier au mauvais type MIME avant toute création en base", async () => {
  const texteBrut = Buffer.from("pas une image").toString("base64");
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      photoDataUrl: `data:text/plain;base64,${texteBrut}`,
      lignes: [{ designation: "X", prix: "1" }],
    }),
  });
  assert.equal(reponse.status, 400);
  const nbDocuments = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  assert.equal(nbDocuments, documentIds.length, "aucun DocumentFournisseur orphelin après un rejet MIME");
});

test("rejette un fichier trop volumineux avant toute création en base (limite JSON Express, 10 Mo)", async () => {
  // Constat (à documenter comme point de vigilance, hérité de Phase 1, non corrigé ici) : un
  // encodage base64 gonfle la taille d'environ 33 % — un fichier juste au-dessus des 8 Mo décodés
  // que storageDocumentsFournisseur.ts est censé rejeter dépasse TOUJOURS, une fois encodé, la
  // limite JSON de 10 Mo d'Express (server/app.ts) ; ce module est donc arrêté en amont par
  // Express (413) avant même d'être atteint pour toute charge réellement assez grande pour
  // déclencher SA propre limite. Ce test vérifie la protection réellement active aujourd'hui.
  const octetsTropGrands = Buffer.alloc(9 * 1024 * 1024, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(octetsTropGrands);
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      photoDataUrl: `data:image/png;base64,${octetsTropGrands.toString("base64")}`,
      lignes: [{ designation: "X", prix: "1" }],
    }),
  });
  assert.equal(reponse.status, 413);
});

test("404 pour un fournisseur inexistant", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/999999`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ societeId, photoDataUrl: PNG_1X1, lignes: [{ designation: "X", prix: "1" }] }),
  });
  assert.equal(reponse.status, 404);
});

// --- Phase 8 : durcissement — cas non explicitement testés jusqu'ici ---

test("401 sans authentification", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ societeId, photoDataUrl: PNG_1X1, lignes: [{ designation: "X", prix: "1" }] }),
  });
  assert.equal(reponse.status, 401);
});

test("absence de lignes -> 400, aucun DocumentFournisseur créé", async () => {
  const nbAvant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ societeId, photoDataUrl: PNG_1X1, lignes: [] }),
  });
  assert.equal(reponse.status, 400);
  assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), nbAvant);
});

// --- Validation humaine (niveau C) ---

test("valide une ligne certaine : clôt l'ancien tarif, crée le nouveau, trace jusqu'au document", async () => {
  const article = await creerArticleAvecTarif("LISTING PHOTO TEST Validation Certaine", "REF-VALID", 20);
  const ancienTarif = await prisma.tarifArticle.findFirstOrThrow({ where: { articleId: article.id, actif: true } });

  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "Peu importe", reference: "REF-VALID", prix: "25,00" }],
    }),
  });
  const { document, lignes } = await reponseCreation.json();
  documentIds.push(document.id);
  const ligne = lignes[0];

  const reponseValidation = await fetch(
    `${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ decisions: [{ ligneId: ligne.id, decision: "VALIDEE", articleRetenuId: article.id }] }),
    }
  );
  assert.equal(reponseValidation.status, 200);
  const resultatValidation = await reponseValidation.json();
  assert.equal(resultatValidation.valides, 1);
  assert.equal(resultatValidation.refusees.length, 0);

  const ancienRelu = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: ancienTarif.id } });
  assert.equal(ancienRelu.actif, false);
  assert.ok(ancienRelu.dateFin);

  const ligneRelue = await prisma.ligneDocumentFournisseur.findUniqueOrThrow({
    where: { id: ligne.id },
    include: { tarifCree: { include: { article: true } } },
  });
  assert.equal(ligneRelue.decision, "VALIDEE");
  assert.equal(ligneRelue.articleRetenuId, article.id);
  assert.ok(ligneRelue.tarifCreeId);
  assert.equal(ligneRelue.tarifCree?.prixHT, 25);
  assert.equal(ligneRelue.tarifCree?.actif, true);

  // Traçabilité complète Article -> TarifArticle -> LigneDocumentFournisseur -> DocumentFournisseur.
  const nouveauTarifAvecSource = await prisma.tarifArticle.findUniqueOrThrow({
    where: { id: ligneRelue.tarifCreeId! },
    include: { ligneDocumentSource: { include: { document: true } } },
  });
  assert.equal(nouveauTarifAvecSource.ligneDocumentSource?.documentId, document.id);
});

test("refuse un articleRetenuId qui n'est ni le proposé ni un candidat alternatif — aucun tarif créé", async () => {
  const articleA = await creerArticleAvecTarif("LISTING PHOTO TEST Refus A", null, 1);
  const articleB = await creerArticleAvecTarif("LISTING PHOTO TEST Refus Autre Article Sans Rapport", null, 1);

  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "LISTING PHOTO TEST Refus A", prix: "1,00" }],
    }),
  });
  const { document, lignes } = await reponseCreation.json();
  documentIds.push(document.id);
  const ligne = lignes[0];
  assert.equal(ligne.articleProposeId, articleA.id);

  const tarifsAvant = await prisma.tarifArticle.count({ where: { articleId: { in: [articleA.id, articleB.id] } } });
  const reponseValidation = await fetch(
    `${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ decisions: [{ ligneId: ligne.id, decision: "VALIDEE", articleRetenuId: articleB.id }] }),
    }
  );
  assert.equal(reponseValidation.status, 200);
  const resultat = await reponseValidation.json();
  assert.equal(resultat.valides, 0);
  assert.equal(resultat.refusees.length, 1);

  const tarifsApres = await prisma.tarifArticle.count({ where: { articleId: { in: [articleA.id, articleB.id] } } });
  assert.equal(tarifsApres, tarifsAvant, "aucun tarif ne doit être créé pour une décision refusée");

  const ligneRelue = await prisma.ligneDocumentFournisseur.findUniqueOrThrow({ where: { id: ligne.id } });
  assert.equal(ligneRelue.decision, "EN_ATTENTE", "la ligne refusée reste en attente, jamais validée de force");
});

test("une ligne FRAIS_LIVRAISON ne peut jamais être validée en tarif, même avec un articleRetenuId arbitraire", async () => {
  const article = await creerArticleAvecTarif("LISTING PHOTO TEST Livraison Cible", null, 1);

  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "Frais de livraison", prix: "15,00" }],
    }),
  });
  const { document, lignes } = await reponseCreation.json();
  documentIds.push(document.id);
  const ligne = lignes[0];
  assert.equal(ligne.natureLigne, "FRAIS_LIVRAISON");

  const tarifsAvant = await prisma.tarifArticle.count({ where: { articleId: article.id } });
  const reponseValidation = await fetch(
    `${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ decisions: [{ ligneId: ligne.id, decision: "VALIDEE", articleRetenuId: article.id }] }),
    }
  );
  const resultat = await reponseValidation.json();
  assert.equal(resultat.valides, 0);
  assert.equal(resultat.refusees.length, 1);
  assert.equal(await prisma.tarifArticle.count({ where: { articleId: article.id } }), tarifsAvant);
});

test("valider un candidat parmi plusieurs candidats proposés : le bon article reçoit le tarif", async () => {
  const articleFermier = await creerArticleAvecTarif("LISTING PHOTO TEST Poulet Mariné Fermier V", null, 1);
  await creerArticleAvecTarif("LISTING PHOTO TEST Poulet Mariné Bio V", null, 1);

  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "LISTING PHOTO TEST Poulet Mariné", prix: "7,00" }],
    }),
  });
  const { document, lignes } = await reponseCreation.json();
  documentIds.push(document.id);
  const ligne = lignes[0];
  assert.equal(ligne.candidatsAlternatifs.length, 2);

  const reponseValidation = await fetch(
    `${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        decisions: [{ ligneId: ligne.id, decision: "VALIDEE", articleRetenuId: articleFermier.id }],
      }),
    }
  );
  assert.equal((await reponseValidation.json()).valides, 1);

  const tarifCree = await prisma.tarifArticle.findFirstOrThrow({
    where: { articleId: articleFermier.id, actif: true },
  });
  assert.equal(tarifCree.prixHT, 7);
});

test("rejeter une ligne (REJETEE) ne crée jamais de tarif", async () => {
  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "Produit sans correspondance quelconque ZZZ", prix: "1,00" }],
    }),
  });
  const { document, lignes } = await reponseCreation.json();
  documentIds.push(document.id);
  const ligne = lignes[0];

  const tarifsAvant = await prisma.tarifArticle.count({ where: { articleId: { in: articleIds } } });
  const reponseValidation = await fetch(
    `${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ decisions: [{ ligneId: ligne.id, decision: "REJETEE" }] }),
    }
  );
  assert.equal((await reponseValidation.json()).rejetees, 1);
  assert.equal(await prisma.tarifArticle.count({ where: { articleId: { in: articleIds } } }), tarifsAvant);

  const ligneRelue = await prisma.ligneDocumentFournisseur.findUniqueOrThrow({ where: { id: ligne.id } });
  assert.equal(ligneRelue.decision, "REJETEE");
  assert.equal(ligneRelue.tarifCreeId, null);
});

// --- Correctif « apprendre le code produit fournisseur d'un import à l'autre » : la validation
// d'une ligne dont le document portait un code (referenceLue) établit ProduitFournisseur pour ce
// couple (fournisseur, code), afin qu'un import ULTÉRIEUR du même fournisseur — listing ou facture,
// même code — propose automatiquement le bon article (motif CODE_ARTICLE, confiance 1), sans
// dépendre d'Article.reference (un seul champ partagé par tout le catalogue, jamais fiable comme
// identité par fournisseur). Voir server/utils/produitFournisseur.ts et rapprochementFournisseur.ts.

test("valider une ligne dont le document portait un code produit établit ProduitFournisseur pour ce fournisseur", async () => {
  const article = await creerArticleAvecTarif("LISTING PHOTO TEST Apprentissage Code", null, 5);

  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "LISTING PHOTO TEST Apprentissage Code", reference: "CODE-APPRIS-1", prix: "5,00" }],
    }),
  });
  const { document, lignes } = await reponseCreation.json();
  documentIds.push(document.id);
  const ligne = lignes[0];
  // Aucun ProduitFournisseur n'existe encore pour ce code : le rapprochement retombe sur la
  // désignation exacte, jamais sur CODE_ARTICLE à ce stade.
  assert.equal(ligne.motifCorrespondance, "DESIGNATION_EXACTE");

  await fetch(`${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decisions: [{ ligneId: ligne.id, decision: "VALIDEE", articleRetenuId: article.id }] }),
  });

  const produitFournisseurCree = await prisma.produitFournisseur.findUniqueOrThrow({
    where: { fournisseurId_codeProduitFournisseur: { fournisseurId, codeProduitFournisseur: "CODE-APPRIS-1" } },
  });
  assert.equal(produitFournisseurCree.articleId, article.id);

  const tarifCree = await prisma.tarifArticle.findFirstOrThrow({ where: { articleId: article.id, actif: true } });
  assert.equal(tarifCree.produitFournisseurId, produitFournisseurCree.id);
});

test("un import FACTURE ultérieur du même fournisseur, même code, propose automatiquement le bon article — même désignation très différente de celle lue sur le listing d'origine", async () => {
  const article = await creerArticleAvecTarif("LISTING PHOTO TEST Cross Listing Facture", null, 6);

  const reponseListing = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "LISTING PHOTO TEST Cross Listing Facture", reference: "CODE-CROSS-1", prix: "6,00" }],
    }),
  });
  const { document: documentListing, lignes: lignesListing } = await reponseListing.json();
  documentIds.push(documentListing.id);
  await fetch(`${baseUrl}/api/listings-fournisseur/documents/${documentListing.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      decisions: [{ ligneId: lignesListing[0].id, decision: "VALIDEE", articleRetenuId: article.id }],
    }),
  });

  // Une facture ultérieure, même fournisseur, même code, mais une désignation reformulée
  // différemment de celle lue sur le listing d'origine (ordre des mots différent, typique d'une
  // facture par rapport à un listing du même fournisseur) : le code déjà connu doit primer sur
  // Article.reference/désignation, tant que la désignation reste raisonnablement cohérente avec
  // celle mémorisée (voir le test dédié « désignation très différente » dans
  // rapprochementFournisseur.test.ts pour le cas où elle ne l'est pas).
  const reponseFacture = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      numero: "FACT-CROSS-1",
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "PHOTO LISTING CROSS FACTURE", reference: "CODE-CROSS-1", prix: "6,50" }],
    }),
  });
  const { document: documentFacture, lignes: lignesFacture } = await reponseFacture.json();
  documentIds.push(documentFacture.id);
  const ligneFacture = lignesFacture[0];

  assert.equal(ligneFacture.motifCorrespondance, "CODE_ARTICLE");
  assert.equal(ligneFacture.articleProposeId, article.id);
  assert.equal(ligneFacture.confiance, 1);
});
