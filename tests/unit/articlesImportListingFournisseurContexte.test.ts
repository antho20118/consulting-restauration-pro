import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Test d'intégration réel (app Express réelle, vrai Postgres) — chantier « déplacement de l'import
// listing vers l'onglet Fournisseur ». Objet : quand un fournisseurId de contexte (fiche fournisseur
// → Listings → Importer) est transmis à POST /articles/import et /articles/import/apercu, il doit
// être seul autoritaire pour la totalité de l'import — jamais remplacé par une colonne fournisseur/
// codeFournisseur du fichier (voir cadrage §10), jamais permettre l'écriture chez un fournisseur
// inexistant ou inactif, sans jamais toucher à l'isolation des tarifs déjà garantie par le chantier
// précédent (scoping articleId+fournisseurId).

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let vibelId: number;
let superUId: number;
let fournisseurInactifId: number;
// Audit du 2026-10-01 (F02/F15) : une AUTRE société, avec son propre fournisseur, jamais rattachée
// au compte "admin" de test — sert à prouver qu'un societeId ou un fournisseurId de contexte
// transmis par le client ne peuvent jamais faire écrire ou divulguer des données hors de la
// société réelle du compte connecté (JWT), quoi que le corps de la requête prétende.
let autreSocieteId: number;
let fournisseurAutreSocieteId: number;

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function poster(corps: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corps),
  });
  return { status: reponse.status, corps: await reponse.json() };
}

async function apercu(corps: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/articles/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corps),
  });
  return { status: reponse.status, corps: await reponse.json() };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  token = await connecterAdminDeTest(baseUrl);

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;

  const vibel = await prisma.fournisseur.create({ data: { nom: "CONTEXTE TEST VIBEL", societeId } });
  vibelId = vibel.id;
  const superU = await prisma.fournisseur.create({ data: { nom: "CONTEXTE TEST SUPER U", societeId } });
  superUId = superU.id;
  const inactif = await prisma.fournisseur.create({ data: { nom: "CONTEXTE TEST INACTIF", societeId, actif: false } });
  fournisseurInactifId = inactif.id;

  const autreSociete = await prisma.societe.create({ data: { nom: "CONTEXTE TEST Autre Société" } });
  autreSocieteId = autreSociete.id;
  const fournisseurAutreSociete = await prisma.fournisseur.create({
    data: { nom: "CONTEXTE TEST Fournisseur Autre Société", societeId: autreSocieteId },
  });
  fournisseurAutreSocieteId = fournisseurAutreSociete.id;
});

after(async () => {
  const documents = await prisma.documentFournisseur.findMany({
    where: { fournisseur: { nom: { startsWith: "CONTEXTE TEST" } } },
    select: { id: true },
  });
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { documentId: { in: documents.map((d) => d.id) } } });
  await prisma.documentFournisseur.deleteMany({ where: { id: { in: documents.map((d) => d.id) } } });
  await prisma.produitFournisseur.deleteMany({ where: { fournisseurId: { in: [vibelId, superUId, fournisseurInactifId] } } });
  // Filtré par fournisseurId OU par nom d'article (relation), jamais par une liste d'ids suivie
  // manuellement dans chaque test : robuste même si un test échoue avant d'avoir pu tracer l'id
  // de l'article qu'il a créé.
  await prisma.tarifArticle.deleteMany({
    where: {
      OR: [
        { fournisseurId: { in: [vibelId, superUId, fournisseurInactifId] } },
        { article: { nom: { startsWith: "CONTEXTE TEST" } } },
      ],
    },
  });
  await prisma.article.deleteMany({ where: { nom: { startsWith: "CONTEXTE TEST" } } });
  await prisma.fournisseur.deleteMany({ where: { nom: { startsWith: "CONTEXTE TEST" } } });
  await prisma.societe.deleteMany({ where: { id: autreSocieteId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("1. import avec fournisseurId=VIBEL : le tarif créé est bien rattaché à VIBEL", async () => {
  const { status, corps } = await poster({
    societeId,
    fournisseurId: vibelId,
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    lignes: [{ designation: "CONTEXTE TEST Article Vibel", prix: "10.00", codeProduitFournisseur: "CTX-001" }],
  });
  assert.equal(status, 200);
  assert.equal(corps.crees, 1);

  const article = await prisma.article.findFirstOrThrow({ where: { nom: "CONTEXTE TEST Article Vibel" } });
  const tarif = await prisma.tarifArticle.findFirstOrThrow({ where: { articleId: article.id, actif: true } });
  assert.equal(tarif.fournisseurId, vibelId);
});

test("2. une colonne 'fournisseur' de ligne pointant vers un autre fournisseur est ignorée quand fournisseurId de contexte est fourni", async () => {
  const { status, corps } = await poster({
    societeId,
    fournisseurId: vibelId,
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    lignes: [
      { designation: "CONTEXTE TEST Article Ligne Super U", prix: "12.00", fournisseur: "CONTEXTE TEST SUPER U", codeProduitFournisseur: "CTX-002" },
    ],
  });
  assert.equal(status, 200);
  assert.equal(corps.crees, 1);

  const article = await prisma.article.findFirstOrThrow({ where: { nom: "CONTEXTE TEST Article Ligne Super U" } });
  const tarifs = await prisma.tarifArticle.findMany({ where: { articleId: article.id } });
  assert.equal(tarifs.length, 1);
  assert.equal(tarifs[0].fournisseurId, vibelId, "le fournisseur de contexte doit primer sur la colonne de la ligne");
});

test("3. un import VIBEL de contexte ne clôture jamais le tarif actif de SUPER U pour le même article", async () => {
  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "CONTEXTE TEST Article Partage", categorieId, tvaId, societeId },
  });
  // Tarif préexistant chez SUPER U pour cet article (créé directement en base, hors import, pour
  // isoler la garantie testée).
  const unitePiece = await prisma.unite.findFirstOrThrow({ where: { symbole: { equals: "pièce", mode: "insensitive" } } });
  const conditionnement = await prisma.conditionnement.findFirstOrThrow();
  const tarifSuperU = await prisma.tarifArticle.create({
    data: {
      articleId: article.id,
      fournisseurId: superUId,
      uniteId: unitePiece.id,
      conditionnementId: conditionnement.id,
      quantiteConditionnement: 1,
      prixHT: 9,
    },
  });

  // Désignation exacte mais sans référence : correspondance "approximative" au sens du moteur de
  // rapprochement (voir importListing.ts, typeCorrespondance), donc confirmationArticleId requis
  // pour que l'écriture ait lieu (comportement historique inchangé, non touché par ce chantier).
  const { status, corps } = await poster({
    societeId,
    fournisseurId: vibelId,
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    lignes: [{ designation: "CONTEXTE TEST Article Partage", prix: "7.50", confirmationArticleId: article.id, codeProduitFournisseur: "CTX-003" }],
  });
  assert.equal(status, 200);
  assert.equal(corps.misesAJour, 1);

  const tarifSuperUApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifSuperU.id } });
  assert.equal(tarifSuperUApres.actif, true, "le tarif SUPER U ne doit jamais être clôturé par un import de contexte VIBEL");

  const tarifVibel = await prisma.tarifArticle.findFirstOrThrow({ where: { articleId: article.id, fournisseurId: vibelId, actif: true } });
  assert.equal(tarifVibel.prixHT, 7.5);
});

test("4. fournisseurId de contexte inexistant : 404, aucune écriture", async () => {
  const { status, corps } = await poster({
    societeId,
    fournisseurId: 999999999,
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    lignes: [{ designation: "CONTEXTE TEST Ne doit pas exister", prix: "1.00" }],
  });
  assert.equal(status, 404);
  assert.equal(corps.error, "Fournisseur introuvable");

  const article = await prisma.article.findFirst({ where: { nom: "CONTEXTE TEST Ne doit pas exister" } });
  assert.equal(article, null);
});

test("5. fournisseurId de contexte inactif : 409, aucune écriture, historique non affecté", async () => {
  const { status, corps } = await poster({
    societeId,
    fournisseurId: fournisseurInactifId,
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    lignes: [{ designation: "CONTEXTE TEST Ne doit pas exister non plus", prix: "1.00" }],
  });
  assert.equal(status, 409);
  assert.equal(corps.fournisseurId, fournisseurInactifId);

  const article = await prisma.article.findFirst({ where: { nom: "CONTEXTE TEST Ne doit pas exister non plus" } });
  assert.equal(article, null);
  const documents = await prisma.documentFournisseur.findMany({ where: { fournisseurId: fournisseurInactifId } });
  assert.equal(documents.length, 0);
});

test("6. un même codeProduitFournisseur chez VIBEL et SUPER U (tous deux importés par contexte) reste séparé", async () => {
  // Désignations volontairement sans recouvrement lexical significatif (au-delà de "CONTEXTE
  // TEST") : le moteur de rapprochement par désignation (similariteJaccard, seuil 0.6) est une
  // logique préexistante et hors périmètre de ce chantier — ce test isole le comportement du
  // couple (fournisseurId, codeProduitFournisseur), pas le rapprochement par désignation.
  await poster({
    societeId,
    fournisseurId: vibelId,
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    lignes: [{ designation: "CONTEXTE TEST Camembert Affine 250G", prix: "3.00", codeProduitFournisseur: "ABC123" }],
  });
  await poster({
    societeId,
    fournisseurId: superUId,
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    lignes: [{ designation: "CONTEXTE TEST Farine Ble T55 25KG", prix: "4.00", codeProduitFournisseur: "ABC123" }],
  });

  const articleVibel = await prisma.article.findFirstOrThrow({ where: { nom: "CONTEXTE TEST Camembert Affine 250G" } });
  const articleSuperU = await prisma.article.findFirstOrThrow({ where: { nom: "CONTEXTE TEST Farine Ble T55 25KG" } });

  const produitVibel = await prisma.produitFournisseur.findUniqueOrThrow({
    where: { fournisseurId_codeProduitFournisseur: { fournisseurId: vibelId, codeProduitFournisseur: "ABC123" } },
  });
  const produitSuperU = await prisma.produitFournisseur.findUniqueOrThrow({
    where: { fournisseurId_codeProduitFournisseur: { fournisseurId: superUId, codeProduitFournisseur: "ABC123" } },
  });
  assert.notEqual(produitVibel.id, produitSuperU.id);
  assert.equal(produitVibel.articleId, articleVibel.id);
  assert.equal(produitSuperU.articleId, articleSuperU.id);
});

test("7. aperçu (POST /import/apercu) avec fournisseurId de contexte : la colonne fournisseur de la ligne est ignorée", async () => {
  const { status, corps } = await apercu({
    societeId,
    fournisseurId: vibelId,
    lignes: [{ designation: "CONTEXTE TEST Apercu", prix: "5.00", fournisseur: "CONTEXTE TEST SUPER U", codeProduitFournisseur: "CTX-007" }],
  });
  assert.equal(status, 200);
  assert.equal(corps.propositions.length, 1);
  assert.equal(corps.propositions[0].statut, "creation");
  assert.equal(corps.propositions[0].fournisseurNom, "CONTEXTE TEST VIBEL");
});

test("8. aperçu avec fournisseurId de contexte inactif : 409, aucun appel Prisma d'écriture possible (route en lecture seule de toute façon)", async () => {
  const { status } = await apercu({
    societeId,
    fournisseurId: fournisseurInactifId,
    lignes: [{ designation: "CONTEXTE TEST Apercu Inactif", prix: "5.00" }],
  });
  assert.equal(status, 409);
});

// Régression F02 (audit du 2026-10-01) : POST /articles/import dérivait auparavant la société
// d'écriture du corps de la requête (societeId) au lieu du compte connecté — un societeId
// usurpé aurait permis de créer des articles/fournisseurs dans N'IMPORTE QUELLE société.
test("9. [F02] un societeId usurpé dans le corps est ignoré : l'article est créé dans la société RÉELLE du compte connecté", async () => {
  const { status, corps } = await poster({
    societeId: autreSocieteId, // usurpation : ce n'est PAS la société du compte "admin" connecté
    fournisseurNom: "CONTEXTE TEST VIBEL",
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    // Désignation sans mot commun avec les articles déjà créés par les tests précédents de ce
    // même fichier (ex. "CONTEXTE TEST Article Vibel") : au-delà de 60% de mots partagés
    // (similariteJaccard, SEUIL_CORRESPONDANCE_DESIGNATION), la ligne serait mise "en attente de
    // confirmation" au lieu d'être créée directement — non pertinent ici, l'objet du test est la
    // société d'écriture, pas le rapprochement approximatif.
    lignes: [{ designation: "CONTEXTE TEST Isolation Societe Zzyzx", reference: "CTX-F02", prix: "9.00" }],
  });
  assert.equal(status, 200);
  assert.equal(corps.crees, 1);

  const article = await prisma.article.findFirstOrThrow({ where: { nom: "CONTEXTE TEST Isolation Societe Zzyzx" } });
  assert.equal(article.societeId, societeId, "jamais la société usurpée dans le corps");
  assert.notEqual(article.societeId, autreSocieteId);
});

// Régression F15 (audit du 2026-10-01) : le fournisseur de contexte était résolu par findUnique
// sur le seul id, sans vérifier sa société — un fournisseurId d'une AUTRE société était accepté
// tel quel (divulgation de son nom/statut + rattachement cross-société des tarifs créés).
test("10. [F15] un fournisseurId de contexte appartenant à une AUTRE société est refusé (404), jamais utilisé", async () => {
  const { status, corps } = await poster({
    societeId,
    fournisseurId: fournisseurAutreSocieteId,
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    lignes: [{ designation: "CONTEXTE TEST F15 Ne doit pas exister", prix: "1.00" }],
  });
  assert.equal(status, 404);
  assert.equal(corps.error, "Fournisseur introuvable");

  const article = await prisma.article.findFirst({ where: { nom: "CONTEXTE TEST F15 Ne doit pas exister" } });
  assert.equal(article, null);
});

test("11. [F15] même refus (404) sur l'aperçu (POST /import/apercu) pour un fournisseurId de contexte d'une AUTRE société", async () => {
  const { status, corps } = await apercu({
    societeId,
    fournisseurId: fournisseurAutreSocieteId,
    lignes: [{ designation: "CONTEXTE TEST F15 Apercu", prix: "1.00" }],
  });
  assert.equal(status, 404);
  assert.equal(corps.error, "Fournisseur introuvable");
});
