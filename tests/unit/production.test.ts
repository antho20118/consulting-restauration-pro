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

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let uniteGrammeId: number;
let depotId: number;
let articleId: number;
let recetteId: number;

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

  const uniteGramme =
    (await prisma.unite.findFirst({ where: { symbole: "g" } })) ??
    (await prisma.unite.create({ data: { nom: "Gramme", symbole: "g", type: "poids", facteurBase: 1 } }));
  uniteGrammeId = uniteGramme.id;

  const depot =
    (await prisma.depot.findFirst({ where: { societeId } })) ??
    (await prisma.depot.create({ data: { nom: "Dépôt de test", societeId } }));
  depotId = depot.id;

  // Article à 100% de rendement, 1 unité de base = 1€ (prixHT=1, quantiteConditionnement=1),
  // pour des calculs de quantité faciles à vérifier de tête.
  const article = await prisma.article.create({
    data: {
      nom: "PRODUCTION TEST INGREDIENT",
      reference: "TESTPROD-INTEGRATION",
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      actif: true,
    },
  });
  articleId = article.id;

  await prisma.tarifArticle.create({
    data: {
      articleId,
      fournisseurId,
      uniteId: uniteGrammeId,
      conditionnementId: conditionnement.id,
      quantiteConditionnement: 1,
      prixHT: 1,
      actif: true,
    },
  });

  // Recette à 1 portion, 350g de l'ingrédient (rendement 100%, gain de cuisson nul) — reproduit
  // l'exemple du cahier des charges : 350g/portion × 280 portions = 98kg.
  const reponseRecette = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      societeId,
      nom: "PRODUCTION TEST RECETTE",
      categorieId: null,
      sousCategorieId: null,
      portions: 1,
      poidsPortionG: null,
      poidsAccompagnementG: null,
      prixVenteHT: null,
      instructions: null,
      photo: null,
      lignes: [{ articleId, quantite: 350, uniteId: uniteGrammeId, gainCuissonPct: 0 }],
      etapes: [],
    }),
  });
  assert.equal(reponseRecette.status, 201, "Échec de la création de la recette de test");
  recetteId = (await reponseRecette.json()).id;
});

after(async () => {
  await prisma.stock.deleteMany({ where: { articleId } });
  await prisma.recetteLigne.deleteMany({ where: { recetteId } });
  await prisma.recette.delete({ where: { id: recetteId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.delete({ where: { id: articleId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("planifie la production pour un nombre de portions cible (350g/portion × 280 = 98kg)", async () => {
  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId, cible: { mode: "portions", valeur: 280 } }),
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

test("déduit le stock disponible d'un dépôt du besoin net", async () => {
  await prisma.stock.create({ data: { articleId, depotId, quantite: 8000 } });

  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId, depotId, cible: { mode: "portions", valeur: 280 } }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.lignes[0].stockDisponible, 8000);
  assert.equal(resultat.lignes[0].besoinNet, 90000);

  await prisma.stock.deleteMany({ where: { articleId, depotId } });
});

test("mode poidsFiniG : déduit le nombre de portions correspondant", async () => {
  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId, cible: { mode: "poidsFiniG", valeur: 98000 } }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.portionsCible, 280);
});

test("ne modifie jamais la recette d'origine", async () => {
  await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId, cible: { mode: "portions", valeur: 280 } }),
  });

  const recette = await prisma.recette.findUnique({
    where: { id: recetteId },
    include: { lignes: true },
  });
  assert.equal(recette?.portions, 1);
  assert.equal(recette?.lignes[0]?.quantite, 350);
});

test("refuse une cible négative", async () => {
  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId, cible: { mode: "portions", valeur: -5 } }),
  });
  assert.equal(reponse.status, 400);
});

test("renvoie 404 pour une recette inexistante", async () => {
  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: 999999999, cible: { mode: "portions", valeur: 10 } }),
  });
  assert.equal(reponse.status, 404);
});
