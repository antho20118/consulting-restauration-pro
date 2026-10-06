import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";
import { normaliserTexte } from "../../server/utils/normaliserTexte.js";

// Test d'intégration réel (vrai serveur Express, vrai Postgres) du chantier ventes — import CSV/
// Excel d'un export de caisse enregistreuse, rapprochement produit vendu -> recette, réconciliation
// food cost théorique/réel. Le moteur de rapprochement pur est déjà couvert exhaustivement par
// tests/unit/rapprochementVentes.test.ts (ALIAS/DESIGNATION_EXACTE/DESIGNATION_APPROXIMATIVE/
// plusieurs_candidats/aucun_candidat) : ce fichier vérifie les aspects qui exigent une vraie base
// (isolation société, apprentissage d'alias persistant, calcul de réconciliation, historique).

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteKgId: number;
let conditionnementId: number;
let fournisseurId: number;
let articleId: number;
let recetteCoutId: number;
let recetteCoutNom: string;
let coutParPortionAttendu: number;
let recetteExacteId: number;
let recetteExacteNom: string;
const recetteIds: number[] = [];
const documentIds: number[] = [];

// Deuxième société, pour vérifier qu'une recette homonyme d'une AUTRE société n'est jamais
// proposée à l'import de ventes de la société courante (voir construireContexteVentes,
// server/routes/ventes.ts : candidats toujours filtrés par societeId).
let societeBId: number;
let recetteBId: number;

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function creerRecette(body: unknown): Promise<{ id: number; nom: string }> {
  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const texte = await reponse.text();
  assert.equal(reponse.status, 201, `Création de recette échouée : ${texte}`);
  const recette = JSON.parse(texte);
  recetteIds.push(recette.id);
  return recette;
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

  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie =
    (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Carton" } }));
  conditionnementId = conditionnement.id;

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "VENTES TEST Fournisseur", societeId } });
  fournisseurId = fournisseur.id;

  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "VENTES TEST Article Volaille", categorieId, tvaId, societeId },
  });
  articleId = article.id;
  await prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId: uniteKgId, conditionnementId, quantiteConditionnement: 1, prixHT: 10 },
  });

  // Recette utilisée pour la réconciliation food cost (coût théorique connu, dérivé du tarif
  // ci-dessus par le moteur de coût existant) — le nom sert aussi de désignation exacte à l'import.
  recetteCoutNom = "Volaille rotie sauce estragon";
  const recetteCout = await creerRecette({
    societeId,
    nom: recetteCoutNom,
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    prixVenteHT: 15,
    lignes: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }],
  });
  recetteCoutId = recetteCout.id;

  const reponseDetail = await fetch(`${baseUrl}/api/recettes/${recetteCoutId}`, { headers: authHeaders() });
  const detail = await reponseDetail.json();
  coutParPortionAttendu = detail.coutParPortion;
  assert.ok(coutParPortionAttendu > 0, "Coût par portion attendu invalide dans la fixture de test");

  // Recette distincte, utilisée pour la désignation exacte / l'alias — aucun lien avec le coût.
  recetteExacteNom = "Ratatouille provencale maison";
  const recetteExacte = await creerRecette({
    societeId,
    nom: recetteExacteNom,
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId, quantite: 0.1, uniteId: uniteKgId, gainCuissonPct: 0 }],
  });
  recetteExacteId = recetteExacte.id;

  // Deuxième société avec une recette EXACTEMENT homonyme de recetteExacte — jamais un candidat
  // valide pour un import de ventes de la première société (Categorie/TVA sont des tables globales,
  // non scopées par société, donc jamais recréées ici : voir prisma/schema.prisma).
  const societeB = await prisma.societe.create({ data: { nom: "VENTES TEST Société B" } });
  societeBId = societeB.id;
  const recetteB = await prisma.recette.create({
    data: { societeId: societeBId, nom: recetteExacteNom, portions: 1 },
  });
  recetteBId = recetteB.id;
});

after(async () => {
  await prisma.ligneVente.deleteMany({ where: { documentVentesId: { in: documentIds } } });
  await prisma.documentVentes.deleteMany({ where: { id: { in: documentIds } } });
  await prisma.aliasProduitVenduImport.deleteMany({ where: { recetteId: { in: recetteIds } } });
  await prisma.recetteLigne.deleteMany({ where: { recetteId: { in: recetteIds } } });
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  await prisma.recette.deleteMany({ where: { id: recetteBId } });
  await prisma.societe.deleteMany({ where: { id: societeBId } }).catch(() => {});
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.deleteMany({ where: { id: articleId } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("POST /ventes/import/apercu : désignation manquante ou quantité illisible -> invalide, jamais de proposition", async () => {
  const reponse = await fetch(`${baseUrl}/api/ventes/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ lignes: [{ designation: "", quantite: "3" }, { designation: "Un produit", quantite: "" }] }),
  });
  assert.equal(reponse.status, 200);
  const { lignes } = await reponse.json();
  assert.equal(lignes[0].statut, "invalide");
  assert.equal(lignes[1].statut, "invalide");
});

test("POST /ventes/import/apercu : désignation strictement identique au nom d'une recette -> certaine (DESIGNATION_EXACTE)", async () => {
  const reponse = await fetch(`${baseUrl}/api/ventes/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ lignes: [{ designation: recetteExacteNom.toUpperCase(), quantite: "5" }] }),
  });
  assert.equal(reponse.status, 200);
  const { lignes } = await reponse.json();
  assert.equal(lignes[0].statut, "certaine");
  assert.equal(lignes[0].motifCorrespondance, "DESIGNATION_EXACTE");
  assert.equal(lignes[0].recetteProposeeId, recetteExacteId);
});

test("POST /ventes/import/apercu : aucune recette suivie ne correspond -> aucun_candidat, jamais de création silencieuse", async () => {
  const reponse = await fetch(`${baseUrl}/api/ventes/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ lignes: [{ designation: "Coca-Cola 33cl inconnu du menu", quantite: "12" }] }),
  });
  assert.equal(reponse.status, 200);
  const { lignes } = await reponse.json();
  assert.equal(lignes[0].statut, "aucun_candidat");
});

test("POST /ventes/import/apercu : une recette homonyme d'une AUTRE société n'est jamais proposée (isolation société)", async () => {
  // Vérifié directement en base : la recette de société B existe bel et bien avec ce nom exact.
  const homonyme = await prisma.recette.findUnique({ where: { id: recetteBId } });
  assert.equal(homonyme?.nom, recetteExacteNom);

  const reponse = await fetch(`${baseUrl}/api/ventes/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ lignes: [{ designation: recetteExacteNom, quantite: "1" }] }),
  });
  const { lignes } = await reponse.json();
  // Le seul candidat valide pour la société connectée (admin) est recetteExacteId, jamais recetteBId.
  assert.equal(lignes[0].recetteProposeeId, recetteExacteId);
  assert.notEqual(lignes[0].recetteProposeeId, recetteBId);
});

test("POST /ventes/import : écrit les lignes, refuse une recette retenue non conforme à la proposition, apprend l'alias confirmé", async () => {
  const designationAlias = "PROD VOLAILLE ROTIE CAISSE 42";
  const reponse = await fetch(`${baseUrl}/api/ventes/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      nomFichierOriginal: "export-caisse-test.csv",
      lignes: [
        // Désignation exacte, décision explicitement validée avec la bonne recette.
        { designation: recetteExacteNom, quantite: "3", decision: "VALIDEE", recetteRetenueId: recetteExacteId },
        // Décision VALIDEE mais recetteRetenueId ne correspond à aucun candidat réel (aucun_candidat
        // côté serveur) : jamais accepté tel quel, retombe en EN_ATTENTE, jamais un choix arbitraire.
        { designation: designationAlias, quantite: "2", decision: "VALIDEE", recetteRetenueId: recetteExacteId },
        // Ligne explicitement rejetée par l'utilisateur.
        { designation: "Boisson non fichée", quantite: "7", decision: "REJETEE" },
      ],
    }),
  });
  const texte = await reponse.text();
  assert.equal(reponse.status, 201, `Import échoué : ${texte}`);
  const resultat = JSON.parse(texte);
  documentIds.push(resultat.document.id);

  assert.equal(resultat.validees, 1);
  assert.equal(resultat.rejetees, 1);
  assert.equal(resultat.enAttente, 1);
  assert.ok(resultat.erreurs.length >= 1);

  // designationAlias ne correspondait à aucune recette (aucun_candidat) : aucun alias n'a donc été
  // appris pour lui, contrairement à recetteExacteNom validé plus haut.
  const aliasAppris = await prisma.aliasProduitVenduImport.findUnique({
    where: { texteNormalise: normaliserTexte(recetteExacteNom) },
  });
  assert.equal(aliasAppris?.recetteId, recetteExacteId);
  const aliasNonAppris = await prisma.aliasProduitVenduImport.findUnique({
    where: { texteNormalise: normaliserTexte(designationAlias) },
  });
  assert.equal(aliasNonAppris, null);
});

test("POST /ventes/import/apercu : une désignation distincte, déjà apprise comme alias, est proposée en ALIAS", async () => {
  const designationDifferente = "PLAT DU JOUR 12";
  await prisma.aliasProduitVenduImport.upsert({
    where: { texteNormalise: normaliserTexte(designationDifferente) },
    create: { texteNormalise: normaliserTexte(designationDifferente), recetteId: recetteExacteId },
    update: { recetteId: recetteExacteId },
  });

  const reponse = await fetch(`${baseUrl}/api/ventes/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ lignes: [{ designation: designationDifferente, quantite: "1" }] }),
  });
  const { lignes } = await reponse.json();
  assert.equal(lignes[0].statut, "certaine");
  assert.equal(lignes[0].motifCorrespondance, "ALIAS");
  assert.equal(lignes[0].recetteProposeeId, recetteExacteId);
});

test("GET /ventes/documents : l'historique reflète les compteurs de décision de l'import réalisé", async () => {
  const reponse = await fetch(`${baseUrl}/api/ventes/documents`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  const documents: { id: number; nomFichierOriginal: string | null; validees: number; rejetees: number; enAttente: number; totalLignes: number }[] =
    await reponse.json();
  const notre = documents.find((d) => d.id === documentIds[0]);
  assert.ok(notre, "Document de test introuvable dans l'historique");
  assert.equal(notre!.nomFichierOriginal, "export-caisse-test.csv");
  assert.equal(notre!.validees, 1);
  assert.equal(notre!.rejetees, 1);
  assert.equal(notre!.enAttente, 1);
  assert.equal(notre!.totalLignes, 3);
});

test("GET /ventes/reconciliation : food cost théorique/réel calculé à partir des seules ventes VALIDEE", async () => {
  // Une deuxième vente VALIDEE pour recetteCoutId, cette fois SANS prix unitaire : le CA réel
  // agrégé doit alors rester null (jamais reconstitué) plutôt que d'ignorer silencieusement la
  // vente sans prix, voir server/routes/ventes.ts.
  const reponseImport = await fetch(`${baseUrl}/api/ventes/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      lignes: [
        {
          designation: recetteCoutNom,
          quantite: "4",
          prixUnitaire: "15",
          decision: "VALIDEE",
          recetteRetenueId: recetteCoutId,
        },
        { designation: recetteCoutNom, quantite: "2", decision: "VALIDEE", recetteRetenueId: recetteCoutId },
      ],
    }),
  });
  const resultatImport = await reponseImport.json();
  assert.equal(reponseImport.status, 201);
  documentIds.push(resultatImport.document.id);
  assert.equal(resultatImport.validees, 2);

  const reponse = await fetch(`${baseUrl}/api/ventes/reconciliation`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  const { recettes } = await reponse.json();
  const ligneRecette = recettes.find((r: { recetteId: number }) => r.recetteId === recetteCoutId);
  assert.ok(ligneRecette, "Recette de réconciliation introuvable");

  assert.equal(ligneRecette.quantiteVendue, 6);
  assert.equal(ligneRecette.ventesSansPrix, 2);
  // Une vente sans prix dans l'agrégat : le CA réel n'est jamais partiellement reconstitué.
  assert.equal(ligneRecette.chiffreAffairesReel, null);
  assert.equal(ligneRecette.foodCostReelPct, null);

  const coutTheoriqueTotalAttendu = Math.round(6 * coutParPortionAttendu * 1e6) / 1e6;
  assert.equal(Math.round(ligneRecette.coutTheoriqueTotal * 1e6) / 1e6, coutTheoriqueTotalAttendu);
});
