import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Test d'intégration réel (vrai serveur Express, vrai Postgres, vrai fichier) de la Phase 5 —
// fiche fournisseur : GET /fournisseurs/:id, /:id/tarifs, /:id/documents, et
// GET /listings-fournisseur/documents/:documentId. Aucun de ces quatre points d'accès n'existait
// avant cette phase (vérifié par lecture directe des fichiers de routes avant modification).

let server: Server;
let baseUrl: string;
let token: string;
let dossierTemporaire: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteId: number;
let conditionnementId: number;
let fournisseurAvecDonnees: number;
let fournisseurVide: number;
const articleIds: number[] = [];
const documentIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

before(async () => {
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "fournisseur-detail-test-"));
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
  const categorie = (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const unite =
    (await prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteId = unite.id;
  const conditionnement = (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Carton" } }));
  conditionnementId = conditionnement.id;

  const fournisseur1 = await prisma.fournisseur.create({ data: { nom: "FICHE FOURNISSEUR TEST Avec Données", societeId } });
  fournisseurAvecDonnees = fournisseur1.id;
  const fournisseur2 = await prisma.fournisseur.create({ data: { nom: "FICHE FOURNISSEUR TEST Vide", societeId } });
  fournisseurVide = fournisseur2.id;

  // Tarif SANS document source (créé manuellement, comme avant ce chantier) — doit rester valide.
  const articleManuel = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "FICHE FOURNISSEUR TEST Article Manuel", categorieId, tvaId, societeId },
  });
  articleIds.push(articleManuel.id);
  await prisma.tarifArticle.create({
    data: {
      articleId: articleManuel.id,
      fournisseurId: fournisseurAvecDonnees,
      uniteId,
      conditionnementId,
      quantiteConditionnement: 1,
      prixHT: 15,
    },
  });

  // Tarif AVEC document source réel, via le pipeline complet Phase 4 (listing photo → validation).
  const articleTrace = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "FICHE FOURNISSEUR TEST Article Tracé", categorieId, tvaId, societeId },
  });
  articleIds.push(articleTrace.id);

  const reponseCreation = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurAvecDonnees}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      nomFichierOriginal: "premier-listing.png",
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "FICHE FOURNISSEUR TEST Article Tracé", prix: "22,00" }],
    }),
  });
  const corpsCreation = await reponseCreation.json();
  const premierDocument = corpsCreation.document;
  documentIds.push(premierDocument.id);
  const ligneReelle = corpsCreation.lignes[0];

  await fetch(`${baseUrl}/api/listings-fournisseur/documents/${premierDocument.id}/valider`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      decisions: [{ ligneId: ligneReelle.id, decision: "VALIDEE", articleRetenuId: articleTrace.id }],
    }),
  });

  // Second document pour ce même fournisseur (vérifie "plusieurs documents").
  const reponseCreation2 = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurAvecDonnees}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      nomFichierOriginal: "second-listing.png",
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "Produit non rapproché quelconque", prix: "3,00" }],
    }),
  });
  documentIds.push((await reponseCreation2.json()).document.id);
});

after(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId: { in: [fournisseurAvecDonnees, fournisseurVide] } } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId: { in: [fournisseurAvecDonnees, fournisseurVide] } } });
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.fournisseur.deleteMany({ where: { id: { in: [fournisseurAvecDonnees, fournisseurVide] } } });
  delete process.env.DOCUMENTS_STORAGE_PATH;
  await fs.rm(dossierTemporaire, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

// --- GET /fournisseurs/:id ---

test("GET /fournisseurs/:id : 401 sans authentification", async () => {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurAvecDonnees}`);
  assert.equal(reponse.status, 401);
});

test("GET /fournisseurs/:id : 400 pour un identifiant non numérique (tentative de traversal incluse)", async () => {
  const r1 = await fetch(`${baseUrl}/api/fournisseurs/abc`, { headers: authHeaders() });
  assert.equal(r1.status, 400);
  const r2 = await fetch(`${baseUrl}/api/fournisseurs/${encodeURIComponent("../../etc/passwd")}`, { headers: authHeaders() });
  assert.equal(r2.status, 400);
});

test("GET /fournisseurs/:id : 404 pour un fournisseur inexistant", async () => {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs/999999`, { headers: authHeaders() });
  assert.equal(reponse.status, 404);
});

test("GET /fournisseurs/:id : 200 avec les champs réels pour un fournisseur existant", async () => {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurAvecDonnees}`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.id, fournisseurAvecDonnees);
  assert.equal(corps.nom, "FICHE FOURNISSEUR TEST Avec Données");
});

// --- GET /fournisseurs/:id/tarifs ---

test("GET /:id/tarifs : tableau vide pour un fournisseur sans tarif", async () => {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurVide}/tarifs`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  assert.deepEqual(await reponse.json(), []);
});

test("GET /:id/tarifs : 404 pour un fournisseur inexistant", async () => {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs/999999/tarifs`, { headers: authHeaders() });
  assert.equal(reponse.status, 404);
});

test("GET /:id/tarifs : un tarif sans document source reste valide (ligneDocumentSource === null)", async () => {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurAvecDonnees}/tarifs`, { headers: authHeaders() });
  const tarifs = await reponse.json();
  const tarifManuel = tarifs.find((t: { article: { nom: string } }) => t.article.nom === "FICHE FOURNISSEUR TEST Article Manuel");
  assert.ok(tarifManuel, "le tarif créé manuellement doit apparaître");
  assert.equal(tarifManuel.ligneDocumentSource, null);
});

test("GET /:id/tarifs : un tarif avec document source expose la traçabilité complète", async () => {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurAvecDonnees}/tarifs`, { headers: authHeaders() });
  const tarifs = await reponse.json();
  const tarifTrace = tarifs.find((t: { article: { nom: string } }) => t.article.nom === "FICHE FOURNISSEUR TEST Article Tracé");
  assert.ok(tarifTrace, "le tarif tracé doit apparaître");
  assert.ok(tarifTrace.ligneDocumentSource, "doit porter sa source documentaire");
  assert.equal(tarifTrace.ligneDocumentSource.document.type, "LISTING");
  assert.match(tarifTrace.ligneDocumentSource.document.cle, /^[0-9a-f-]{36}$/);
  assert.equal(tarifTrace.prixHT, 22);
});

// --- GET /fournisseurs/:id/documents ---

test("GET /:id/documents : tableau vide pour un fournisseur sans document", async () => {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurVide}/documents`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  assert.deepEqual(await reponse.json(), []);
});

test("GET /:id/documents : retourne les DEUX documents d'un fournisseur qui en a plusieurs", async () => {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurAvecDonnees}/documents`, { headers: authHeaders() });
  const documents = await reponse.json();
  assert.equal(documents.length, 2);
  assert.ok(documents.every((d: { type: string }) => d.type === "LISTING"));
  assert.ok(documents.every((d: { _count: { lignes: number } }) => d._count.lignes >= 1));
});

// --- GET /listings-fournisseur/documents/:documentId ---

test("GET /listings-fournisseur/documents/:id : 400 pour un identifiant invalide", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/documents/abc`, { headers: authHeaders() });
  assert.equal(reponse.status, 400);
});

test("GET /listings-fournisseur/documents/:id : 404 pour un document inexistant", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/documents/999999`, { headers: authHeaders() });
  assert.equal(reponse.status, 404);
});

test("GET /listings-fournisseur/documents/:id : distingue article proposé / retenu, jamais confondus", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${documentIds[0]}`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.lignes.length, 1);
  const ligne = corps.lignes[0];
  assert.equal(ligne.decision, "VALIDEE");
  assert.equal(ligne.articleRetenu.nom, "FICHE FOURNISSEUR TEST Article Tracé");
  assert.ok(ligne.tarifCreeId);
});

test("GET /listings-fournisseur/documents/:id : une ligne non rapprochée reste visiblement EN_ATTENTE", async () => {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/documents/${documentIds[1]}`, { headers: authHeaders() });
  const corps = await reponse.json();
  assert.equal(corps.lignes[0].decision, "EN_ATTENTE");
  assert.equal(corps.lignes[0].articleRetenu, null);
});

// --- Phase 7 : historique des tarifs fournisseurs ---
//
// Fixtures scopées à ce describe (before/after propres, jamais mêlées à celles ci-dessus) pour
// exercer explicitement : plusieurs tarifs historiques d'un même article, une source FACTURE, et
// (depuis le chantier « identité fournisseur + produit fournisseur + historique des tarifs »)
// l'ABSENCE de clôture croisée entre fournisseurs. Avant ce chantier, TarifArticle.actif était
// recherché par articleId SEUL (voir server/routes/listingsFournisseur.ts et server/routes/articles.ts),
// ce qui clôturait le tarif actif d'un fournisseur A dès qu'un import chez un fournisseur B portait
// sur le même article — documenté ici comme "PARTICULARITÉ RÉELLE (non corrigée)" jusqu'à ce
// chantier. La recherche est désormais scopée par (articleId, fournisseurId) (ou produitFournisseurId
// quand un code produit est connu) : ce test vérifie maintenant que les deux fournisseurs conservent
// chacun leur propre tarif actif, simultanément, sur le même article.
describe("Phase 7 — historique des tarifs (actif/historique, source, ordre, particularité cross-fournisseur)", () => {
  let fournisseurHistorique: number;
  let fournisseurAutre: number;
  let articleMultiHistorique: number;
  let articleFacture: number;
  let articlePartage: number;
  const articleIdsPhase7: number[] = [];

  before(async () => {
    const f1 = await prisma.fournisseur.create({ data: { nom: "FICHE FOURNISSEUR TEST P7 Historique", societeId } });
    fournisseurHistorique = f1.id;
    const f2 = await prisma.fournisseur.create({ data: { nom: "FICHE FOURNISSEUR TEST P7 Autre", societeId } });
    fournisseurAutre = f2.id;

    // Article avec 1 tarif actif + 2 tarifs historiques (dates distinctes) chez le même fournisseur.
    const aMulti = await prisma.article.create({
      data: { type: "MATIERE_PREMIERE", nom: "FICHE FOURNISSEUR TEST P7 Article Multi", categorieId, tvaId, societeId },
    });
    articleMultiHistorique = aMulti.id;
    articleIdsPhase7.push(aMulti.id);
    await prisma.tarifArticle.create({
      data: {
        articleId: aMulti.id, fournisseurId: fournisseurHistorique, uniteId, conditionnementId,
        quantiteConditionnement: 1, prixHT: 10,
        dateDebut: new Date("2024-01-01"), dateFin: new Date("2024-06-01"), actif: false,
      },
    });
    await prisma.tarifArticle.create({
      data: {
        articleId: aMulti.id, fournisseurId: fournisseurHistorique, uniteId, conditionnementId,
        quantiteConditionnement: 1, prixHT: 11,
        dateDebut: new Date("2024-06-01"), dateFin: new Date("2024-12-01"), actif: false,
      },
    });
    await prisma.tarifArticle.create({
      data: {
        articleId: aMulti.id, fournisseurId: fournisseurHistorique, uniteId, conditionnementId,
        quantiteConditionnement: 1, prixHT: 12,
        dateDebut: new Date("2024-12-01"), dateFin: null, actif: true,
      },
    });

    // Article dont le tarif actif provient réellement d'une FACTURE (pipeline complet Phase 6).
    const aFacture = await prisma.article.create({
      data: { type: "MATIERE_PREMIERE", nom: "FICHE FOURNISSEUR TEST P7 Article Facture", categorieId, tvaId, societeId },
    });
    articleFacture = aFacture.id;
    articleIdsPhase7.push(aFacture.id);
    const reponseFacture = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurHistorique}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        societeId,
        numero: "P7-FA-001",
        dateDocument: "2025-01-10",
        montantTotal: 5,
        photoDataUrl: PNG_1X1,
        nomFichierOriginal: "facture-p7.png",
        lignes: [{ designation: "FICHE FOURNISSEUR TEST P7 Article Facture", prix: "5,00" }],
      }),
    });
    const corpsFacture = await reponseFacture.json();
    const ligneFacture = corpsFacture.lignes[0];
    await fetch(`${baseUrl}/api/listings-fournisseur/documents/${corpsFacture.document.id}/valider`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ decisions: [{ ligneId: ligneFacture.id, decision: "VALIDEE", articleRetenuId: aFacture.id }] }),
    });

    // Article partagé : tarif actif d'abord chez fournisseurHistorique, puis un import chez
    // fournisseurAutre pour LE MÊME article — depuis ce chantier, le tarif de fournisseurHistorique
    // reste actif (jamais clôturé par l'import chez l'autre fournisseur) : chaque fournisseur
    // conserve son propre tarif actif, simultanément, sur le même article (voir le test corrigé
    // plus bas).
    const aPartage = await prisma.article.create({
      data: { type: "MATIERE_PREMIERE", nom: "FICHE FOURNISSEUR TEST P7 Article Partage", categorieId, tvaId, societeId },
    });
    articlePartage = aPartage.id;
    articleIdsPhase7.push(aPartage.id);
    await prisma.tarifArticle.create({
      data: {
        articleId: aPartage.id, fournisseurId: fournisseurHistorique, uniteId, conditionnementId,
        quantiteConditionnement: 1, prixHT: 8, actif: true,
      },
    });

    const reponseAutre = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurAutre}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        societeId,
        nomFichierOriginal: "listing-p7-autre.png",
        photoDataUrl: PNG_1X1,
        lignes: [{ designation: "FICHE FOURNISSEUR TEST P7 Article Partage", prix: "9,00" }],
      }),
    });
    const corpsAutre = await reponseAutre.json();
    const ligneAutre = corpsAutre.lignes[0];
    await fetch(`${baseUrl}/api/listings-fournisseur/documents/${corpsAutre.document.id}/valider`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ decisions: [{ ligneId: ligneAutre.id, decision: "VALIDEE", articleRetenuId: aPartage.id }] }),
    });
  });

  after(async () => {
    await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId: { in: [fournisseurHistorique, fournisseurAutre] } } } });
    await prisma.documentFournisseur.deleteMany({ where: { fournisseurId: { in: [fournisseurHistorique, fournisseurAutre] } } });
    await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIdsPhase7 } } });
    await prisma.article.deleteMany({ where: { id: { in: articleIdsPhase7 } } });
    await prisma.fournisseur.deleteMany({ where: { id: { in: [fournisseurHistorique, fournisseurAutre] } } });
  });

  test("401 sans authentification sur /:id/tarifs", async () => {
    const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurHistorique}/tarifs`);
    assert.equal(reponse.status, 401);
  });

  test("400 pour un identifiant invalide sur /:id/tarifs", async () => {
    const reponse = await fetch(`${baseUrl}/api/fournisseurs/abc/tarifs`, { headers: authHeaders() });
    assert.equal(reponse.status, 400);
  });

  test("plusieurs tarifs historiques pour le même article sont tous restitués, ordre dateDebut décroissant", async () => {
    const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurHistorique}/tarifs`, { headers: authHeaders() });
    const tarifs = await reponse.json();
    const lignesMulti = tarifs.filter((t: { article: { id: number } }) => t.article.id === articleMultiHistorique);
    assert.equal(lignesMulti.length, 3);

    const dates = lignesMulti.map((t: { dateDebut: string }) => t.dateDebut);
    const datesTriees = [...dates].sort().reverse();
    assert.deepEqual(dates, datesTriees, "l'ordre restitué par la route doit être dateDebut décroissant");

    const historiques = lignesMulti.filter((t: { actif: boolean }) => !t.actif);
    assert.equal(historiques.length, 2, "deux tarifs historiques pour ce même article");
    assert.ok(historiques.every((t: { dateFin: string | null }) => t.dateFin !== null));

    const actifs = lignesMulti.filter((t: { actif: boolean }) => t.actif);
    assert.equal(actifs.length, 1);
    assert.equal(actifs[0].dateFin, null);
  });

  test("cohérence actif <=> dateFin sur toutes les lignes réellement restituées pour ce fournisseur", async () => {
    const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurHistorique}/tarifs`, { headers: authHeaders() });
    const tarifs = await reponse.json();
    for (const t of tarifs as { id: number; actif: boolean; dateFin: string | null }[]) {
      assert.equal(t.actif, t.dateFin === null, `tarif ${t.id} : actif=${t.actif} incohérent avec dateFin=${t.dateFin}`);
    }
  });

  test("source FACTURE : un tarif issu d'une facture expose ligneDocumentSource.document.type === 'FACTURE'", async () => {
    const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurHistorique}/tarifs`, { headers: authHeaders() });
    const tarifs = await reponse.json();
    const tarifFacture = (tarifs as { article: { id: number }; ligneDocumentSource: { document: { type: string } } | null }[]).find(
      (t) => t.article.id === articleFacture
    );
    assert.ok(tarifFacture?.ligneDocumentSource, "doit porter sa source documentaire");
    assert.equal(tarifFacture!.ligneDocumentSource!.document.type, "FACTURE");
  });

  test("plusieurs articles différents apparaissent tous, groupés par nom d'article croissant (ordre existant, verrouillé)", async () => {
    const reponse = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurHistorique}/tarifs`, { headers: authHeaders() });
    const tarifs = await reponse.json();
    const noms = (tarifs as { article: { nom: string } }[]).map((t) => t.article.nom);
    assert.ok(new Set(noms).size >= 2, "plusieurs articles distincts doivent être présents");

    // Chaque article ne doit former qu'un unique bloc contigu (jamais entrelacé avec un autre), ces
    // blocs devant être triés par nom croissant — conséquence directe du tri existant
    // [{article:{nom:"asc"}},{dateDebut:"desc"}], non modifié par cette phase.
    const blocs: string[] = [];
    for (const nom of noms) {
      if (blocs[blocs.length - 1] !== nom) blocs.push(nom);
    }
    assert.equal(new Set(blocs).size, blocs.length, "un même article ne doit jamais réapparaître dans un bloc séparé");
    assert.deepEqual(blocs, [...blocs].sort((a, b) => a.localeCompare(b)), "les blocs d'articles doivent être triés par nom croissant");
  });

  test("consultation seule : GET /:id/tarifs n'écrit rien en base (aucun nouveau TarifArticle)", async () => {
    const avant = await prisma.tarifArticle.count({ where: { articleId: { in: articleIdsPhase7 } } });
    await fetch(`${baseUrl}/api/fournisseurs/${fournisseurHistorique}/tarifs`, { headers: authHeaders() });
    await fetch(`${baseUrl}/api/fournisseurs/${fournisseurHistorique}/tarifs`, { headers: authHeaders() });
    const apres = await prisma.tarifArticle.count({ where: { articleId: { in: articleIdsPhase7 } } });
    assert.equal(apres, avant);
  });

  test("CORRIGÉ : un tarif créé chez un AUTRE fournisseur pour le même article ne clôture plus le tarif actif du fournisseur consulté", async () => {
    const reponseOrigine = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurHistorique}/tarifs`, { headers: authHeaders() });
    const tarifsOrigine = await reponseOrigine.json();
    const tarifPartageChezOrigine = (tarifsOrigine as { article: { id: number }; actif: boolean; dateFin: string | null; prixHT: number }[]).find(
      (t) => t.article.id === articlePartage
    );
    assert.ok(tarifPartageChezOrigine, "le tarif doit toujours apparaître dans l'historique de ce fournisseur, jamais masqué");
    assert.equal(
      tarifPartageChezOrigine!.actif,
      true,
      "ne doit plus jamais être clôturé par un import chez un AUTRE fournisseur (recherche désormais scopée articleId+fournisseurId, voir server/routes/listingsFournisseur.ts et articles.ts)"
    );
    assert.equal(tarifPartageChezOrigine!.dateFin, null);
    assert.equal(tarifPartageChezOrigine!.prixHT, 8);

    const reponseAutre = await fetch(`${baseUrl}/api/fournisseurs/${fournisseurAutre}/tarifs`, { headers: authHeaders() });
    const tarifsAutre = await reponseAutre.json();
    const tarifPartageChezAutre = (tarifsAutre as { article: { id: number }; actif: boolean; prixHT: number }[]).find(
      (t) => t.article.id === articlePartage
    );
    assert.ok(tarifPartageChezAutre);
    assert.equal(tarifPartageChezAutre!.actif, true, "l'autre fournisseur a bien lui aussi son propre tarif actif, simultanément");
    assert.equal(tarifPartageChezAutre!.prixHT, 9);
  });
});
