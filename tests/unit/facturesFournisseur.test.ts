import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Test d'intégration réel (vrai serveur Express, vrai Postgres, vrai fichier) de la Phase 6 —
// import de factures fournisseurs + déduplication graduée (option C validée par l'utilisateur).
// Même principe que tests/unit/listingsFournisseur.test.ts (Phase 4).

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
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "factures-fournisseur-test-"));
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

  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
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

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "FACTURE TEST Fournisseur", societeId } });
  fournisseurId = fournisseur.id;
});

after(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIds } } });
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

function corpsFacture(overrides: Record<string, unknown> = {}) {
  return {
    societeId,
    photoDataUrl: PNG_1X1,
    nomFichierOriginal: "facture.png",
    numero: "FA-9001",
    dateDocument: "2026-03-15",
    montantTotal: 100,
    lignes: [{ designation: "FACTURE TEST Article", prix: "10,00" }],
    ...overrides,
  };
}

// --- Extraction (vision IA) ---

test("POST /factures/import-ia : 503 quand ANTHROPIC_API_KEY n'est pas configurée (état réel de cet environnement)", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/import-ia`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ photoDataUrl: PNG_1X1 }),
  });
  assert.equal(reponse.status, 503);
});

// --- Sécurité de base ---

test("POST /factures/:fournisseurId : 401 sans authentification", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpsFacture()),
  });
  assert.equal(reponse.status, 401);
});

test("POST /factures/:fournisseurId : 404 pour un fournisseur inexistant", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/999999`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture()),
  });
  assert.equal(reponse.status, 404);
});

test("POST /factures/:fournisseurId : 400 pour un identifiant invalide", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/abc`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture()),
  });
  assert.equal(reponse.status, 400);
});

// --- Import réel sans doublon ---

test("import d'une facture valide : DocumentFournisseur(FACTURE) créé avec ses métadonnées, aucun TarifArticle créé", async () => {
  const article = await creerArticleAvecTarif("FACTURE TEST Article Réel", 5);
  const tarifsAvant = await prisma.tarifArticle.count({ where: { articleId: article.id } });

  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(
      corpsFacture({ numero: "FA-1001", lignes: [{ designation: "FACTURE TEST Article Réel", prix: "6,00" }] })
    ),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  documentIds.push(corps.document.id);

  assert.equal(corps.document.type, "FACTURE");
  assert.equal(corps.document.numero, "FA-1001");
  assert.equal(corps.document.montantTotal, 100);
  assert.match(corps.document.cle, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(corps.document).includes("base64"), false);

  assert.equal(corps.lignes.length, 1);
  assert.equal(corps.lignes[0].articleProposeId, article.id);

  assert.equal(await prisma.tarifArticle.count({ where: { articleId: article.id } }), tarifsAvant);
});

// --- Déduplication ---

test("doublon FORTE : numéro + date + montant identiques -> alerte, aucune création", async () => {
  const reponseInitiale = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2001" })),
  });
  const docInitial = (await reponseInitiale.json()).document;
  documentIds.push(docInitial.id);

  const nbDocumentsAvant = await prisma.documentFournisseur.count({ where: { fournisseurId } });

  const reponseDoublon = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2001" })),
  });
  assert.equal(reponseDoublon.status, 200);
  const corpsDoublon = await reponseDoublon.json();
  assert.ok(corpsDoublon.doublon);
  assert.equal(corpsDoublon.doublon.niveau, "FORTE");
  assert.equal(corpsDoublon.doublon.correspondances[0].documentId, docInitial.id);
  assert.equal(corpsDoublon.document, undefined, "aucun document ne doit être renvoyé/créé pour une alerte");

  assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), nbDocumentsAvant);
});

test("doublon FAIBLE : numéro identique mais date différente -> alerte de niveau FAIBLE", async () => {
  const reponseInitiale = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2002", dateDocument: "2026-01-01" })),
  });
  documentIds.push((await reponseInitiale.json()).document.id);

  const reponseDoublon = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2002", dateDocument: "2026-06-15" })),
  });
  assert.equal(reponseDoublon.status, 200);
  const corps = await reponseDoublon.json();
  assert.equal(corps.doublon.niveau, "FAIBLE");
});

test("numéro identique mais montant différent -> alerte de niveau FAIBLE", async () => {
  const reponseInitiale = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2003", montantTotal: 100 })),
  });
  documentIds.push((await reponseInitiale.json()).document.id);

  const reponseDoublon = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2003", montantTotal: 250 })),
  });
  const corps = await reponseDoublon.json();
  assert.equal(corps.doublon.niveau, "FAIBLE");
});

test("numéro différent -> aucune alerte, import normal", async () => {
  const reponseInitiale = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2004" })),
  });
  documentIds.push((await reponseInitiale.json()).document.id);

  const reponseSuivante = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2004-BIS" })),
  });
  assert.equal(reponseSuivante.status, 201);
  const corps = await reponseSuivante.json();
  documentIds.push(corps.document.id);
  assert.equal(corps.doublon, undefined);
});

test("numéro absent -> aucune tentative de détection, import normal", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: null })),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  documentIds.push(corps.document.id);
  assert.equal(corps.document.numero, null);
});

test("confirmerDoublon:true -> l'import a réellement lieu malgré l'alerte, sans redétection infinie", async () => {
  const reponseInitiale = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2005" })),
  });
  documentIds.push((await reponseInitiale.json()).document.id);

  // Sans confirmerDoublon : alerte, rien créé.
  const reponseSansConfirmation = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2005" })),
  });
  assert.ok((await reponseSansConfirmation.json()).doublon);

  // Avec confirmerDoublon : import réellement effectué, un second DocumentFournisseur coexiste
  // avec le même numéro (jamais de contrainte unique — voir règle 6 du cadrage).
  const nbAvant = await prisma.documentFournisseur.count({ where: { fournisseurId, numero: "FA-2005" } });
  const reponseConfirmee = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2005", confirmerDoublon: true })),
  });
  assert.equal(reponseConfirmee.status, 201);
  const corpsConfirme = await reponseConfirmee.json();
  documentIds.push(corpsConfirme.document.id);
  assert.equal(corpsConfirme.document.numero, "FA-2005");

  const nbApres = await prisma.documentFournisseur.count({ where: { fournisseurId, numero: "FA-2005" } });
  assert.equal(nbApres, nbAvant + 1, "la traçabilité de la confirmation est la coexistence des deux documents");
});

test("utilisateur refuse le doublon (ne rappelle pas avec confirmerDoublon) : aucun tarif créé, aucun document orphelin", async () => {
  const reponseInitiale = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2006" })),
  });
  documentIds.push((await reponseInitiale.json()).document.id);

  const nbDocumentsAvant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const nbTarifsAvant = await prisma.tarifArticle.count({ where: { fournisseurId } });

  await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-2006" })),
  });
  // L'utilisateur voit l'alerte et n'appelle jamais confirmerDoublon:true — rien de plus à faire
  // côté test que vérifier l'absence de toute écriture supplémentaire.

  assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), nbDocumentsAvant);
  assert.equal(await prisma.tarifArticle.count({ where: { fournisseurId } }), nbTarifsAvant);
});

// --- Sécurité approfondie ---

test("MIME interdit -> 400, aucun DocumentFournisseur créé", async () => {
  const texteBrut = Buffer.from("pas une image").toString("base64");
  const nbAvant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-3001", photoDataUrl: `data:text/plain;base64,${texteBrut}` })),
  });
  assert.equal(reponse.status, 400);
  assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), nbAvant);
});

// --- Phase 8 : durcissement — cas non explicitement testés jusqu'ici ---

test("absence de lignes -> 400, aucun DocumentFournisseur créé", async () => {
  const nbAvant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-3006", lignes: [] })),
  });
  assert.equal(reponse.status, 400);
  assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), nbAvant);
});

// Reproduction ciblée (Phase 8, §7 du cadrage) : importFacturePhotoIA.ts rapporte volontairement la
// date telle qu'écrite sur le document (chaîne brute, ex. "15/03/2026"), jamais convertie à
// l'extraction — c'est la route qui fait `new Date(dateDocument)`. Ce test vérifie le comportement
// RÉEL du serveur face à une chaîne de date qu'il ne sait pas parser, sans présumer du résultat.
test("dateDocument non parsable par `new Date(...)` (ex. chaîne au format français brut) : comportement réel observé, jamais un crash non géré masqué", async () => {
  const nbAvant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-3007", dateDocument: "15/03/2026" })),
  });
  // Constat, pas une correction : voir le rapport Phase 8 (bug préexistant Catégorie B, hors
  // Phases 4-7 côté frontend qui normalise déjà en amont — jamais corrigé silencieusement ici).
  if (reponse.status === 201) {
    const corps = await reponse.json();
    assert.equal(corps.document.dateDocument, null, "si accepté, ne doit jamais persister une date invalide silencieusement convertie en une autre date");
  } else {
    assert.ok([400, 500].includes(reponse.status), `code HTTP inattendu : ${reponse.status}`);
    assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), nbAvant, "aucune écriture partielle en cas d'échec");
  }
});

test("montantTotal non numérique (chaîne) -> traité comme absent (null), jamais une conversion inventée", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-3008", montantTotal: "cent euros" })),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  assert.equal(corps.document.montantTotal, null);
});

test("validation avec un articleRetenuId arbitraire : refusé, aucun tarif créé", async () => {
  const articleCible = await creerArticleAvecTarif("FACTURE TEST Cible Non Proposée", 1);
  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(
      corpsFacture({ numero: "FA-3002", lignes: [{ designation: "Produit totalement inconnu ABC", prix: "1,00" }] })
    ),
  });
  const { document, lignes } = await reponseCreation.json();
  documentIds.push(document.id);
  assert.equal(lignes[0].articleProposeId, null); // aucun candidat pour ce nom

  const nbTarifsAvant = await prisma.tarifArticle.count({ where: { articleId: articleCible.id } });
  const reponseValidation = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decisions: [{ ligneId: lignes[0].id, decision: "VALIDEE", articleRetenuId: articleCible.id }] }),
  });
  const resultat = await reponseValidation.json();
  assert.equal(resultat.valides, 0);
  assert.equal(resultat.refusees.length, 1);
  assert.equal(await prisma.tarifArticle.count({ where: { articleId: articleCible.id } }), nbTarifsAvant);
});

test("double validation de la même ligne : la seconde est refusée, un seul tarif créé", async () => {
  const article = await creerArticleAvecTarif("FACTURE TEST Double Validation", 8);
  // creerArticleAvecTarif crée déjà un TarifArticle de départ (utilisé pour le rapprochement
  // désignation-exacte) : on part de ce compte, pas de zéro, comme ailleurs dans ce fichier (voir
  // "import d'une facture valide" ci-dessus).
  const tarifsAvant = await prisma.tarifArticle.count({ where: { articleId: article.id } });

  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-3003", lignes: [{ designation: "FACTURE TEST Double Validation", prix: "9,00" }] })),
  });
  const { document, lignes } = await reponseCreation.json();
  documentIds.push(document.id);
  const ligne = lignes[0];

  const decisions = { decisions: [{ ligneId: ligne.id, decision: "VALIDEE", articleRetenuId: article.id }] };
  const premiere = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(decisions),
  });
  assert.equal((await premiere.json()).valides, 1);

  const seconde = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${document.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(decisions),
  });
  const resultatSeconde = await seconde.json();
  assert.equal(resultatSeconde.valides, 0);
  assert.equal(resultatSeconde.refusees.length, 1);

  // La première validation crée exactement un nouveau TarifArticle (niveau C) ; la seconde,
  // refusée, n'en crée aucun de plus.
  assert.equal(await prisma.tarifArticle.count({ where: { articleId: article.id } }), tarifsAvant + 1);
});

test("ligne appartenant à un autre document : refusée", async () => {
  const reponseA = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-3004" })),
  });
  const docA = (await reponseA.json()).document;
  documentIds.push(docA.id);

  const reponseB = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsFacture({ numero: "FA-3005" })),
  });
  const corpsB = await reponseB.json();
  documentIds.push(corpsB.document.id);
  const ligneDeB = corpsB.lignes[0];

  const reponseValidation = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${docA.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decisions: [{ ligneId: ligneDeB.id, decision: "REJETEE" }] }),
  });
  const resultat = await reponseValidation.json();
  assert.equal(resultat.refusees.length, 1);
});

test("document inexistant lors de la validation -> 404", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/documents/999999/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decisions: [{ ligneId: 1, decision: "REJETEE" }] }),
  });
  assert.equal(reponse.status, 404);
});
