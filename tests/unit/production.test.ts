import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel : démarre l'application Express réelle sur un port éphémère, crée les
// données nécessaires via Prisma/l'API réelle sur la base Postgres configurée par DATABASE_URL,
// appelle POST /api/production/planifier par de vraies requêtes HTTP, puis nettoie tout ce qu'il a
// créé. Contrairement à un test qui vérifierait des opérations arithmétiques isolées, celui-ci
// exerce le vrai code de production (server/utils/planifierProduction.ts et
// server/routes/production.ts).
//
// Couvre en particulier la conversion en unité de base (voir server/utils/planifierProduction.ts) :
// ligne.quantite est exprimée dans l'unité choisie pour la ligne (ligne.unite), pas dans l'unité de
// base — elle doit être multipliée par ligne.unite.facteurBase avant d'être mise à l'échelle et
// comparée au stock (toujours en unité de base). Testé avec plusieurs facteurBase distincts
// (1, 1000, 1000 sur un type différent) pour vérifier que la conversion n'est pas un correctif
// spécifique à kg→g mais fonctionne pour n'importe quelle unité.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let uniteGrammeId: number;
let uniteKgId: number;
let uniteLitreId: number;
let unitePieceId: number;
let depotId: number;
let articleGrammeId: number;
let articleKgId: number;
let articleLitreId: number;
let articlePieceId: number;
const recetteIds: number[] = [];

async function creerRecette(body: unknown): Promise<{ id: number }> {
  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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

  // Un seul identifiant de connexion partagé existe pour toute l'application (voir
  // server/routes/auth.ts) : réutilise celui déjà en place s'il existe (convention du projet :
  // admin/1234), ou le crée s'il n'existe pas encore (environnement de test neuf). Ne modifie
  // jamais un identifiant déjà présent.
  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({
      data: { identifiant: "admin", codeHache: hacherCode("1234") },
    });
  }

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: "admin", code: "1234" }),
  });
  assert.equal(
    reponseLogin.status,
    200,
    "Connexion admin/1234 impossible : un identifiant différent est déjà configuré sur cette base de test."
  );
  token = (await reponseLogin.json()).token;

  // Données de référence attendues déjà présentes via `npm run db:seed` ; créées ici à la volée
  // si absentes, pour que ce test reste indépendant de l'ordre d'exécution du seed.
  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;

  const categorie =
    (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;

  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;

  const fournisseur =
    (await prisma.fournisseur.findFirst()) ??
    (await prisma.fournisseur.create({ data: { nom: "Fournisseur de test", societeId } }));
  fournisseurId = fournisseur.id;

  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));

  // Quatre unités à facteurBase distincts (voir prisma/seed.ts pour les valeurs de référence du
  // projet) : gramme (base du poids, facteurBase=1), kilogramme (facteurBase=1000), litre (base du
  // volume = millilitre, facteurBase=1000), pièce (base du discret, facteurBase=1). Couvre les 3
  // familles d'unités utilisées dans l'application, pas seulement kg/g.
  const uniteGramme =
    (await prisma.unite.findFirst({ where: { symbole: "g" } })) ??
    (await prisma.unite.create({ data: { nom: "Gramme", symbole: "g", type: "poids", facteurBase: 1 } }));
  uniteGrammeId = uniteGramme.id;

  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;

  const uniteLitre =
    (await prisma.unite.findFirst({ where: { symbole: "L" } })) ??
    (await prisma.unite.create({ data: { nom: "Litre", symbole: "L", type: "volume", facteurBase: 1000 } }));
  uniteLitreId = uniteLitre.id;

  const unitePiece =
    (await prisma.unite.findFirst({ where: { symbole: "pièce" } })) ??
    (await prisma.unite.create({ data: { nom: "Pièce", symbole: "pièce", type: "unite", facteurBase: 1 } }));
  unitePieceId = unitePiece.id;

  const depot =
    (await prisma.depot.findFirst({ where: { societeId } })) ??
    (await prisma.depot.create({ data: { nom: "Dépôt de test", societeId } }));
  depotId = depot.id;

  // Un article par unité, rendement 100 % (sans incidence sur quantiteProduction/besoinNet, qui ne
  // dépendent que de la quantité de ligne et de l'échelle — le rendement n'affecte que le poids fini
  // et le coût) et sans tarif (non nécessaire : planifierProduction ne lit jamais le prix).
  async function creerArticle(nom: string, reference: string) {
    return prisma.article.create({
      data: {
        nom,
        reference,
        type: "MATIERE_PREMIERE",
        categorieId,
        tvaId,
        societeId,
        rendement: 100,
        actif: true,
      },
    });
  }

  articleGrammeId = (await creerArticle("PRODUCTION TEST INGREDIENT", "TESTPROD-INTEGRATION")).id;
  articleKgId = (await creerArticle("PRODUCTION TEST POULET (kg)", "TESTPROD-KG")).id;
  articleLitreId = (await creerArticle("PRODUCTION TEST HUILE (L)", "TESTPROD-L")).id;
  articlePieceId = (await creerArticle("PRODUCTION TEST OEUF (pièce)", "TESTPROD-PIECE")).id;

  void fournisseurId; // conservé pour cohérence avec les fixtures achats/consulting, non utilisé ici
  void conditionnement;
});

after(async () => {
  const articleIds = [articleGrammeId, articleKgId, articleLitreId, articlePieceId];
  await prisma.stock.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.recetteLigne.deleteMany({ where: { recetteId: { in: recetteIds } } });
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("[1] ingrédient en grammes (facteurBase=1) : planifie la production pour un nombre de portions cible (350g/portion × 280 = 98kg)", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "PRODUCTION TEST RECETTE GRAMMES",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId: articleGrammeId, quantite: 350, uniteId: uniteGrammeId, gainCuissonPct: 0 }],
    etapes: [],
  });

  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, cible: { mode: "portions", valeur: 280 } }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.portionsCible, 280);
  assert.equal(resultat.poidsFiniCibleG, 98000);
  assert.equal(resultat.lignes.length, 1);
  assert.equal(resultat.lignes[0].quantiteProduction, 98000);
  assert.equal(resultat.lignes[0].stockDisponible, 0);
  assert.equal(resultat.lignes[0].besoinNet, 98000);
});

test("[CRITIQUE] [2][6][7][9] ingrédient en kilogrammes (facteurBase=1000) : 1kg par ligne × 4 portions, cible 40 portions, stock 3kg → quantiteProduction=10000g, besoinNet=7000g", async () => {
  // Scénario exact signalé par l'audit final post-intégration (main 467ce3a) : avant correctif,
  // planifierProduction utilisait ligne.quantite (=1, dans l'unité "kg" saisie) directement, sans le
  // multiplier par ligne.unite.facteurBase (=1000), et le comparait tel quel à stockDisponible (en
  // unité de base, donc en grammes). Résultat obtenu avant correctif : quantiteProduction=10,
  // besoinNet=0 (au lieu de 10000 et 7000) — l'ancien code échoue sur ce test, le nouveau doit
  // réussir avec exactement ces valeurs.
  const recette = await creerRecette({
    societeId,
    nom: "PRODUCTION TEST RECETTE KG CRITIQUE",
    categorieId: null,
    sousCategorieId: null,
    portions: 4,
    lignes: [{ articleId: articleKgId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [],
  });

  await prisma.stock.create({ data: { articleId: articleKgId, depotId, quantite: 3000 } });

  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, depotId, cible: { mode: "portions", valeur: 40 } }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.echelle, 10);
  assert.equal(resultat.lignes[0].quantiteProduction, 10000, "quantiteProduction doit être en unité de base (grammes), pas dans l'unité brute 'kg'");
  assert.equal(resultat.lignes[0].stockDisponible, 3000);
  assert.equal(resultat.lignes[0].besoinNet, 7000, "besoinNet doit être 10000 (besoin) - 3000 (stock) = 7000, pas 0");

  await prisma.stock.deleteMany({ where: { articleId: articleKgId, depotId } });
});

test("[5] stock suffisant (couvre le besoin) : besoinNet=0, jamais négatif", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "PRODUCTION TEST RECETTE KG STOCK SUFFISANT",
    categorieId: null,
    sousCategorieId: null,
    portions: 4,
    lignes: [{ articleId: articleKgId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [],
  });

  // Besoin réel = 10000g (échelle 10), stock largement supérieur : 15000g.
  await prisma.stock.create({ data: { articleId: articleKgId, depotId, quantite: 15000 } });

  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, depotId, cible: { mode: "portions", valeur: 40 } }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.lignes[0].quantiteProduction, 10000);
  assert.equal(resultat.lignes[0].stockDisponible, 15000);
  assert.equal(resultat.lignes[0].besoinNet, 0, "un stock supérieur au besoin ne doit jamais produire un besoin net négatif");

  await prisma.stock.deleteMany({ where: { articleId: articleKgId, depotId } });
});

test("[10] cible en poids fini : la conversion d'unité s'applique aussi en mode poidsFiniG (pas seulement en mode portions)", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "PRODUCTION TEST RECETTE KG POIDS FINI",
    categorieId: null,
    sousCategorieId: null,
    portions: 4,
    lignes: [{ articleId: articleKgId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [],
  });

  // poidsFiniTotalG de la recette telle qu'écrite (rendement 100%, sans gain de cuisson) = 1000g ;
  // cible 9000g => échelle = 9.
  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, cible: { mode: "poidsFiniG", valeur: 9000 } }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.echelle, 9);
  assert.equal(resultat.portionsCible, 36);
  assert.equal(resultat.lignes[0].quantiteProduction, 9000, "la conversion en unité de base doit aussi s'appliquer en mode poidsFiniG");
  assert.equal(resultat.lignes[0].besoinNet, 9000);
});

test("[3][4][8] plusieurs lignes à unités différentes (g, kg, L, pièce) dans la même recette : chaque ligne convertie indépendamment avec son propre facteurBase", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "PRODUCTION TEST RECETTE MULTI-UNITES",
    categorieId: null,
    sousCategorieId: null,
    portions: 2,
    lignes: [
      { articleId: articleGrammeId, quantite: 50, uniteId: uniteGrammeId, gainCuissonPct: 0 },
      { articleId: articleKgId, quantite: 0.5, uniteId: uniteKgId, gainCuissonPct: 0 },
      { articleId: articleLitreId, quantite: 0.1, uniteId: uniteLitreId, gainCuissonPct: 0 },
      { articleId: articlePieceId, quantite: 4, uniteId: unitePieceId, gainCuissonPct: 0 },
    ],
    etapes: [],
  });

  // Échelle 3 (2 -> 6 portions). Base (unité de base) par ligne : 50g, 500g (0,5kg), 100mL (0,1L),
  // 4 pièces. Attendu après échelle : 150g, 1500g, 300mL, 12 pièces.
  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, cible: { mode: "portions", valeur: 6 } }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.echelle, 3);
  const parArticle = new Map(resultat.lignes.map((l: { articleId: number; quantiteProduction: number; besoinNet: number }) => [l.articleId, l]));

  const ligneG = parArticle.get(articleGrammeId) as { quantiteProduction: number; besoinNet: number };
  assert.equal(ligneG.quantiteProduction, 150);
  assert.equal(ligneG.besoinNet, 150);

  const ligneKg = parArticle.get(articleKgId) as { quantiteProduction: number; besoinNet: number };
  assert.equal(ligneKg.quantiteProduction, 1500);
  assert.equal(ligneKg.besoinNet, 1500);

  const ligneLitre = parArticle.get(articleLitreId) as { quantiteProduction: number; besoinNet: number };
  assert.equal(ligneLitre.quantiteProduction, 300);
  assert.equal(ligneLitre.besoinNet, 300);

  const lignePiece = parArticle.get(articlePieceId) as { quantiteProduction: number; besoinNet: number };
  assert.equal(lignePiece.quantiteProduction, 12);
  assert.equal(lignePiece.besoinNet, 12);
});

test("déduit le stock disponible d'un dépôt du besoin net (ingrédient déjà en unité de base, grammes)", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "PRODUCTION TEST RECETTE GRAMMES STOCK",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId: articleGrammeId, quantite: 350, uniteId: uniteGrammeId, gainCuissonPct: 0 }],
    etapes: [],
  });

  await prisma.stock.create({ data: { articleId: articleGrammeId, depotId, quantite: 8000 } });

  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, depotId, cible: { mode: "portions", valeur: 280 } }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.lignes[0].stockDisponible, 8000);
  assert.equal(resultat.lignes[0].besoinNet, 90000);

  await prisma.stock.deleteMany({ where: { articleId: articleGrammeId, depotId } });
});

test("ne modifie jamais la recette d'origine", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "PRODUCTION TEST RECETTE NON-MUTATION",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId: articleGrammeId, quantite: 350, uniteId: uniteGrammeId, gainCuissonPct: 0 }],
    etapes: [],
  });

  await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, cible: { mode: "portions", valeur: 280 } }),
  });

  const relue = await prisma.recette.findUnique({
    where: { id: recette.id },
    include: { lignes: true },
  });
  assert.equal(relue?.portions, 1);
  assert.equal(relue?.lignes[0]?.quantite, 350);
});

test("[12] refuse une cible négative (validation Zod, 400)", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "PRODUCTION TEST CIBLE NEGATIVE",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId: articleGrammeId, quantite: 350, uniteId: uniteGrammeId, gainCuissonPct: 0 }],
    etapes: [],
  });

  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, cible: { mode: "portions", valeur: -5 } }),
  });
  assert.equal(reponse.status, 400);
});

test("[12] refuse un corps de requête structurellement invalide (recetteId manquant)", async () => {
  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cible: { mode: "portions", valeur: 10 } }),
  });
  assert.equal(reponse.status, 400);
});

test("[12] refuse un mode de cible inconnu", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "PRODUCTION TEST MODE INCONNU",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId: articleGrammeId, quantite: 350, uniteId: uniteGrammeId, gainCuissonPct: 0 }],
    etapes: [],
  });

  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, cible: { mode: "kilogrammes", valeur: 10 } }),
  });
  assert.equal(reponse.status, 400);
});

test("[11] renvoie 404 pour une recette inexistante", async () => {
  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: 999999999, cible: { mode: "portions", valeur: 10 } }),
  });
  assert.equal(reponse.status, 404);
});
