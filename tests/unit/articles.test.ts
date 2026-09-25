import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre POST /api/articles et PUT /api/articles/:id (app Express réelle,
// vrai Postgres) — voir tests/unit/articlesImportListing.test.ts pour le même principe.
//
// Objet du Lot A (caractérisation « validation serveur POST/PUT /articles ») : une désignation
// vide/trop longue, un prix négatif, un rendement hors des bornes acceptées par le moteur de coût
// (coutRecette.ts::rendementValide, ]0, 1000]) ou un type hors de l'enum Prisma ne doivent plus
// jamais être acceptés en écriture — refusés en 400, jamais en base. Le comportement déjà correct
// (type jamais modifiable via PUT) doit rester inchangé.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteId: number;
const articleIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
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
  assert.equal(reponseLogin.status, 200);
  token = (await reponseLogin.json()).token;

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const unite = (await prisma.unite.findFirst()) ?? (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteId = unite.id;
});

after(async () => {
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { nom: { startsWith: "ARTICLES VALIDATION TEST" } } });
  await prisma.fournisseur.deleteMany({ where: { nom: "Fournisseur Test Validation" } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function payloadBase(nom: string) {
  return {
    nom,
    reference: "",
    categorieId,
    tvaId,
    societeId,
    rendement: 100,
    type: "MATIERE_PREMIERE",
  };
}

test("POST /articles — désignation vide refusée (400), rien créé", async () => {
  const avant = await prisma.article.count();
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("")),
  });
  assert.equal(reponse.status, 400);
  const corps = await reponse.json();
  assert.match(corps.error, /invalide/i);
  const apres = await prisma.article.count();
  assert.equal(apres, avant, "aucun article ne doit avoir été créé");
});

test("POST /articles — désignation composée uniquement d'espaces refusée (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("     ")),
  });
  assert.equal(reponse.status, 400);
});

test("POST /articles — désignation de plus de 200 caractères refusée (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("X".repeat(201))),
  });
  assert.equal(reponse.status, 400);
});

test("POST /articles — désignation valide toujours acceptée (non-régression)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("ARTICLES VALIDATION TEST Article Valide")),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  articleIds.push(corps.id);
  assert.equal(corps.nom, "ARTICLES VALIDATION TEST Article Valide");
});

test("POST /articles — prixHT négatif refusé (400), aucun article ni tarif créé", async () => {
  const avantArticles = await prisma.article.count();
  const avantTarifs = await prisma.tarifArticle.count();
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      ...payloadBase("ARTICLES VALIDATION TEST Prix Negatif"),
      uniteId,
      prixHT: -10,
      fournisseurNom: "Fournisseur Test Validation",
    }),
  });
  assert.equal(reponse.status, 400);
  assert.equal(await prisma.article.count(), avantArticles);
  assert.equal(await prisma.tarifArticle.count(), avantTarifs);
});

test("POST /articles — prixHT à 0 toujours accepté (choix produit préservé)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      ...payloadBase("ARTICLES VALIDATION TEST Prix Zero"),
      uniteId,
      prixHT: 0,
      fournisseurNom: "Fournisseur Test Validation",
    }),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  articleIds.push(corps.id);
  assert.equal(corps.tarifs[0].prixHT, 0);
});

test("POST /articles — rendement négatif refusé (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase("ARTICLES VALIDATION TEST Rendement Negatif"), rendement: -50 }),
  });
  assert.equal(reponse.status, 400);
});

test("POST /articles — rendement à 0 refusé (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase("ARTICLES VALIDATION TEST Rendement Zero"), rendement: 0 }),
  });
  assert.equal(reponse.status, 400);
});

test("POST /articles — rendement supérieur à 1000 refusé (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase("ARTICLES VALIDATION TEST Rendement Excessif"), rendement: 99999 }),
  });
  assert.equal(reponse.status, 400);
});

test("POST /articles — rendement valide (100) toujours accepté (non-régression)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase("ARTICLES VALIDATION TEST Rendement Valide"), rendement: 100 }),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  articleIds.push(corps.id);
});

test("POST /articles — type hors de l'enum refusé (400, jamais une erreur Prisma brute)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase("ARTICLES VALIDATION TEST Type Invalide"), type: "TYPE_INEXISTANT" }),
  });
  assert.equal(reponse.status, 400);
  const corps = await reponse.json();
  assert.match(corps.error, /invalide/i);
  assert.notEqual(corps.name, "PrismaClientValidationError", "aucune erreur interne Prisma ne doit fuiter au client");
});

test("POST /articles — type manquant refusé (400)", async () => {
  const payload = payloadBase("ARTICLES VALIDATION TEST Type Manquant") as Record<string, unknown>;
  delete payload.type;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  assert.equal(reponse.status, 400);
});

test("PUT /articles/:id — désignation vide refusée (400), article inchangé en base", async () => {
  const creation = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("ARTICLES VALIDATION TEST Modification Base")),
  });
  const article = await creation.json();
  articleIds.push(article.id);

  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ nom: "", reference: "", categorieId, rendement: 100 }),
  });
  assert.equal(reponse.status, 400);

  const enBase = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(enBase.nom, "ARTICLES VALIDATION TEST Modification Base", "le nom en base ne doit pas avoir changé");
});

test("PUT /articles/:id — prixHT négatif refusé (400), tarif actif inchangé", async () => {
  const creation = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      ...payloadBase("ARTICLES VALIDATION TEST Modification Prix"),
      uniteId,
      prixHT: 15,
      fournisseurNom: "Fournisseur Test Validation",
    }),
  });
  const article = await creation.json();
  articleIds.push(article.id);
  const tarifAvantId = article.tarifs[0].id;

  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({
      nom: article.nom,
      reference: "",
      categorieId,
      rendement: 100,
      uniteId,
      prixHT: -30,
      fournisseurNom: "Fournisseur Test Validation",
    }),
  });
  assert.equal(reponse.status, 400);

  const tarifApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifAvantId } });
  assert.equal(tarifApres.actif, true, "le tarif d'origine ne doit pas avoir été clôturé");
  assert.equal(tarifApres.prixHT, 15, "le prix d'origine ne doit pas avoir changé");
  const nombreTarifs = await prisma.tarifArticle.count({ where: { articleId: article.id } });
  assert.equal(nombreTarifs, 1, "aucun tarif supplémentaire ne doit avoir été créé");
});

test("PUT /articles/:id — rendement hors bornes refusé (400)", async () => {
  const creation = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("ARTICLES VALIDATION TEST Modification Rendement")),
  });
  const article = await creation.json();
  articleIds.push(article.id);

  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ nom: article.nom, reference: "", categorieId, rendement: -1 }),
  });
  assert.equal(reponse.status, 400);

  const enBase = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(enBase.rendement, 100, "le rendement en base ne doit pas avoir changé");
});

test("PUT /articles/:id — le type reste inchangé même si transmis dans le payload (non-régression)", async () => {
  const creation = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("ARTICLES VALIDATION TEST Type Immuable")),
  });
  const article = await creation.json();
  articleIds.push(article.id);

  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({
      nom: article.nom,
      reference: "",
      categorieId,
      rendement: 100,
      type: "PETIT_MATERIEL",
    }),
  });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.type, "MATIERE_PREMIERE", "PUT ne doit jamais pouvoir changer le type d'un article");
});
