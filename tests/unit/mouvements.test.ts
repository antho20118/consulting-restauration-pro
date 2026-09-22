import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre GET/POST /api/mouvements (app Express réelle, Postgres configuré
// par DATABASE_URL). Voir tests/unit/achats.test.ts pour le même principe appliqué à un autre
// endpoint. Vérifie en particulier que l'unité de base de l'article (g/mL/unité, jamais l'unité
// d'achat du tarif) accompagne bien chaque mouvement — voir server/routes/mouvements.ts.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let conditionnementId: number;
let uniteKgId: number;
let depotId: number;
let articlePoidsId: number;
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

  const fournisseur = await prisma.fournisseur.create({
    data: { nom: "Fournisseur test mouvements", societeId },
  });
  fournisseurId = fournisseur.id;

  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));
  conditionnementId = conditionnement.id;

  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;

  const depot =
    (await prisma.depot.findFirst({ where: { societeId } })) ??
    (await prisma.depot.create({ data: { nom: "Dépôt de test mouvements", societeId } }));
  depotId = depot.id;

  // Article acheté au kg (tarif en kg, facteurBase 1000) : la quantité de mouvement doit rester en
  // grammes (unité de base) et s'afficher comme telle, jamais comme "kg".
  const articlePoids = await prisma.article.create({
    data: {
      nom: "MOUVEMENTS TEST ARTICLE POIDS",
      reference: "TESTMVT-POIDS",
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      actif: true,
    },
  });
  articlePoidsId = articlePoids.id;
  await prisma.tarifArticle.create({
    data: {
      articleId: articlePoidsId,
      fournisseurId,
      uniteId: uniteKgId,
      conditionnementId,
      quantiteConditionnement: 10,
      prixHT: 100,
      actif: true,
    },
  });

  const articleSansTarif = await prisma.article.create({
    data: {
      nom: "MOUVEMENTS TEST ARTICLE SANS TARIF",
      reference: "TESTMVT-SANS-TARIF",
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
  await prisma.mouvementStock.deleteMany({
    where: { articleId: { in: [articlePoidsId, articleSansTarifId] } },
  });
  await prisma.stock.deleteMany({ where: { articleId: { in: [articlePoidsId, articleSansTarifId] } } });
  await prisma.tarifArticle.deleteMany({ where: { articleId: articlePoidsId } });
  await prisma.article.deleteMany({ where: { id: { in: [articlePoidsId, articleSansTarifId] } } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("POST /api/mouvements renvoie l'unité de base (g) d'un article tarifé au kg, pas 'kg'", async () => {
  const reponse = await fetch(`${baseUrl}/api/mouvements`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ articleId: articlePoidsId, depotId, type: "ENTREE", quantite: 5000, motif: "Test" }),
  });
  assert.equal(reponse.status, 201);
  const mouvement = await reponse.json();

  assert.equal(mouvement.quantite, 5000);
  assert.equal(mouvement.article.uniteBase, "g");
});

test("POST /api/mouvements renvoie 'unité de base' par défaut pour un article sans tarif actif", async () => {
  const reponse = await fetch(`${baseUrl}/api/mouvements`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ articleId: articleSansTarifId, depotId, type: "ENTREE", quantite: 3, motif: "Test" }),
  });
  assert.equal(reponse.status, 201);
  const mouvement = await reponse.json();

  assert.equal(mouvement.article.uniteBase, "unité de base");
});

test("GET /api/mouvements liste les mouvements avec l'unité de base de chaque article", async () => {
  const reponse = await fetch(`${baseUrl}/api/mouvements`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(reponse.status, 200);
  const mouvements = await reponse.json();

  const mouvementPoids = mouvements.find((m: { articleId: number }) => m.articleId === articlePoidsId);
  assert.ok(mouvementPoids, "Le mouvement créé sur l'article tarifé au kg doit apparaître dans la liste");
  assert.equal(mouvementPoids.article.uniteBase, "g");
});
