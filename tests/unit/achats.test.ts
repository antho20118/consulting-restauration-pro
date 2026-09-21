import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre POST /api/achats/proposition (app Express réelle, Postgres
// configuré par DATABASE_URL). Voir tests/unit/production.test.ts pour le même principe appliqué
// à un autre endpoint.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurMoinsCherId: number;
let fournisseurPlusCherId: number;
let conditionnementId: number;
let uniteKgId: number;
let depotId: number;
let articleAvecTarifsId: number;
let articleSansTarifId: number;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

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

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;

  const categorie =
    (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;

  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;

  const fournisseurMoinsCher = await prisma.fournisseur.create({
    data: { nom: "Fournisseur test A (moins cher)", societeId },
  });
  fournisseurMoinsCherId = fournisseurMoinsCher.id;
  const fournisseurPlusCher = await prisma.fournisseur.create({
    data: { nom: "Fournisseur test B (plus cher)", societeId },
  });
  fournisseurPlusCherId = fournisseurPlusCher.id;

  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));
  conditionnementId = conditionnement.id;

  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;

  const depot =
    (await prisma.depot.findFirst({ where: { societeId } })) ??
    (await prisma.depot.create({ data: { nom: "Dépôt de test", societeId } }));
  depotId = depot.id;

  // Article avec 2 tarifs actifs de fournisseurs différents : 120€/10kg (12€/kg) et 100€/10kg
  // (10€/kg) — le second doit être retenu comme le moins cher.
  const articleAvecTarifs = await prisma.article.create({
    data: {
      nom: "ACHATS TEST ARTICLE AVEC TARIFS",
      reference: "TESTACHATS-AVEC-TARIF",
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      actif: true,
    },
  });
  articleAvecTarifsId = articleAvecTarifs.id;
  await prisma.tarifArticle.create({
    data: {
      articleId: articleAvecTarifsId,
      fournisseurId: fournisseurPlusCherId,
      uniteId: uniteKgId,
      conditionnementId,
      quantiteConditionnement: 10,
      prixHT: 120,
      actif: true,
    },
  });
  await prisma.tarifArticle.create({
    data: {
      articleId: articleAvecTarifsId,
      fournisseurId: fournisseurMoinsCherId,
      uniteId: uniteKgId,
      conditionnementId,
      quantiteConditionnement: 10,
      prixHT: 100,
      actif: true,
    },
  });

  const articleSansTarif = await prisma.article.create({
    data: {
      nom: "ACHATS TEST ARTICLE SANS TARIF",
      reference: "TESTACHATS-SANS-TARIF",
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      actif: true,
    },
  });
  articleSansTarifId = articleSansTarif.id;
});

after(async () => {
  await prisma.stock.deleteMany({ where: { articleId: { in: [articleAvecTarifsId, articleSansTarifId] } } });
  await prisma.tarifArticle.deleteMany({ where: { articleId: articleAvecTarifsId } });
  await prisma.article.deleteMany({ where: { id: { in: [articleAvecTarifsId, articleSansTarifId] } } });
  await prisma.fournisseur.deleteMany({ where: { id: { in: [fournisseurMoinsCherId, fournisseurPlusCherId] } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("besoin de 23kg / conditionnement 10kg → 3 conditionnements, 30kg commandés, tarif le moins cher retenu", async () => {
  const reponse = await fetch(`${baseUrl}/api/achats/proposition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      besoins: [{ articleId: articleAvecTarifsId, quantite: 23, facteurUniteRecette: 1000 }],
    }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.lignes.length, 1);
  const ligne = resultat.lignes[0];
  assert.equal(ligne.besoinBase, 23000);
  assert.equal(ligne.netBase, 23000);
  assert.equal(ligne.conditionnements, 3);
  assert.equal(ligne.quantiteCommandeeBase, 30000);
  assert.equal(ligne.fournisseurId, fournisseurMoinsCherId);
  assert.equal(ligne.coutCommandeHT, 300);
  assert.equal(ligne.statut, "A_COMMANDER");
  assert.equal(resultat.totalHT, 300);
});

test("signale FOURNISSEUR_MANQUANT pour un article sans tarif actif", async () => {
  const reponse = await fetch(`${baseUrl}/api/achats/proposition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      besoins: [{ articleId: articleSansTarifId, quantite: 5, facteurUniteRecette: 1000 }],
    }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.lignes[0].statut, "FOURNISSEUR_MANQUANT");
});

test("signale ARTICLE_INTROUVABLE pour un articleId inexistant (au lieu de l'omettre silencieusement)", async () => {
  const reponse = await fetch(`${baseUrl}/api/achats/proposition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      besoins: [{ articleId: 999999999, quantite: 2, facteurUniteRecette: 1000 }],
    }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.lignes.length, 1);
  assert.equal(resultat.lignes[0].statut, "ARTICLE_INTROUVABLE");
  assert.equal(resultat.lignes[0].besoinBase, 2000);
});

test("STOCK_SUFFISANT quand le stock d'un dépôt couvre le besoin", async () => {
  await prisma.stock.create({ data: { articleId: articleAvecTarifsId, depotId, quantite: 25000 } });

  const reponse = await fetch(`${baseUrl}/api/achats/proposition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      depotId,
      besoins: [{ articleId: articleAvecTarifsId, quantite: 23, facteurUniteRecette: 1000 }],
    }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.lignes[0].stock, 25000);
  assert.equal(resultat.lignes[0].netBase, 0);
  assert.equal(resultat.lignes[0].statut, "STOCK_SUFFISANT");

  await prisma.stock.deleteMany({ where: { articleId: articleAvecTarifsId, depotId } });
});

test("refuse un corps de requête invalide", async () => {
  const reponse = await fetch(`${baseUrl}/api/achats/proposition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ besoins: [{ articleId: -1, quantite: 5, facteurUniteRecette: 1000 }] }),
  });
  assert.equal(reponse.status, 400);
});
