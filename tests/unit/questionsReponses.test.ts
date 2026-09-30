import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel (vrai serveur Express, vrai Postgres) du catalogue de questions
// prédéfinies (GET /api/questions, GET /api/questions/:cle) — société et compte dédiés, créés ici
// (jamais le compte "admin" partagé par le reste de la suite), par le même principe que
// tests/unit/menuEngineering.test.ts : plusieurs réponses (food-cost-moyen, recette-plus-rentable,
// ingredients-sans-tarif) raisonnent sur la LISTE COMPLÈTE des recettes/articles de la société.

let server: Server;
let baseUrl: string;
let societeId: number;
let token: string;
let utilisateurId: number;
const recetteIds: number[] = [];

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

  const societe = await prisma.societe.create({ data: { nom: `Société questions ${Date.now()}` } });
  societeId = societe.id;

  const identifiant = `questions-test-${Date.now()}`;
  const utilisateur = await prisma.utilisateur.create({
    data: { identifiant, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId },
  });
  utilisateurId = utilisateur.id;

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const corps = await reponseLogin.json();
  token = corps.token;
});

after(async () => {
  await prisma.recette.deleteMany({ where: { societeId } });
  await prisma.utilisateur.delete({ where: { id: utilisateurId } });
  await prisma.societe.delete({ where: { id: societeId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function creerRecetteAvecPrix(nom: string, prixVenteHT: number): Promise<number> {
  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom, prixVenteHT, lignes: [] }),
  });
  if (reponse.status !== 201) {
    throw new Error(`creerRecetteAvecPrix a échoué (${reponse.status}) : ${await reponse.text()}`);
  }
  const corps = await reponse.json();
  recetteIds.push(corps.id);
  return corps.id;
}

test("GET /api/questions renvoie le catalogue fixe de questions", async () => {
  const reponse = await fetch(`${baseUrl}/api/questions`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.ok(Array.isArray(corps));
  assert.ok(corps.length > 0);
  assert.ok(corps.every((q: { cle: unknown; question: unknown }) => typeof q.cle === "string" && typeof q.question === "string"));
});

test("GET /api/questions/:cle répond à la question recette-plus-rentable une fois une recette tarifée", async () => {
  const suffixe = Date.now();
  await creerRecetteAvecPrix(`Q Cheap ${suffixe}`, 5);
  const chereId = await creerRecetteAvecPrix(`Q Expensive ${suffixe}`, 50);

  const reponse = await fetch(`${baseUrl}/api/questions/recette-plus-rentable`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.cle, "recette-plus-rentable");
  assert.ok(corps.reponse.includes(`Q Expensive ${suffixe}`));
  assert.equal(corps.details.recetteId, chereId);
});

test("GET /api/questions/:cle renvoie une réponse honnête quand aucune donnée n'est disponible", async () => {
  const reponse = await fetch(`${baseUrl}/api/questions/commandes-en-attente`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.reponse, "Aucune commande fournisseur en attente de réception.");
});

test("GET /api/questions/:cle renvoie 404 pour une clé inconnue", async () => {
  const reponse = await fetch(`${baseUrl}/api/questions/cle-inexistante`, { headers: authHeaders() });
  assert.equal(reponse.status, 404);
});

test("401 sans jeton d'authentification", async () => {
  const reponse = await fetch(`${baseUrl}/api/questions/food-cost-moyen`);
  assert.equal(reponse.status, 401);
});
