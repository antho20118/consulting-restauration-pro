import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Valeur du stock affichée au tableau de bord (GET /api/dashboard, server/routes/dashboard.ts).
// Le stock est toujours exprimé dans l'unité de base de l'article (g, mL ou pièce — voir
// Stock.quantite) alors que prixHT est le prix d'un conditionnement dans l'unité du tarif (ex.
// 10 € le kg, 65 € le carton de 10 kg) : multiplier l'un par l'autre surévaluait le stock d'un
// facteur 1000 pour un article vendu au kilo (constat de l'audit du 15/10 : 5 kg à 10 €/kg
// affichés 50 000 €). Société dédiée à ce fichier : la valeur agrégée ne dépend que de ses données.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let depotId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let conditionnementId: number;
let uniteKgId: number;
let uniteGrammeId: number;
let utilisateurId: number;
const articleIds: number[] = [];

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  const marqueur = `DASHBOARD-STOCK-${randomUUID()}`;
  societeId = (await prisma.societe.create({ data: { nom: marqueur } })).id;
  const utilisateur = await prisma.utilisateur.create({
    data: { identifiant: marqueur, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId },
  });
  utilisateurId = utilisateur.id;
  const connexion = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: marqueur, code: "1234" }),
  });
  token = ((await connexion.json()) as { token: string }).token;

  categorieId = (await prisma.categorie.create({ data: { nom: marqueur, societeId } })).id;
  tvaId = (await prisma.tVA.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
  fournisseurId = (
    // Avec un code : un fournisseur sans code serait repris par le script de rattrapage
    // (prisma/backfillCodeFournisseur.ts) testé en parallèle par codeFournisseurCreationAutomatique.
    await prisma.fournisseur.create({ data: { nom: marqueur, societeId, codeFournisseur: "FOU-TEST" } })
  ).id;
  depotId = (await prisma.depot.create({ data: { nom: marqueur, societeId } })).id;
  conditionnementId = (
    (await prisma.conditionnement.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.conditionnement.create({ data: { nom: "Unité" } }))
  ).id;
  uniteKgId = (
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }))
  ).id;
  uniteGrammeId = (
    (await prisma.unite.findFirst({ where: { symbole: "g" } })) ??
    (await prisma.unite.create({ data: { nom: "Gramme", symbole: "g", type: "poids", facteurBase: 1 } }))
  ).id;
});

after(async () => {
  try {
    await prisma.stock.deleteMany({ where: { articleId: { in: articleIds } } });
    await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIds } } });
    await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
    await prisma.depot.deleteMany({ where: { societeId } });
    await prisma.fournisseur.deleteMany({ where: { societeId } });
    await prisma.categorie.deleteMany({ where: { societeId } });
    await prisma.utilisateur.deleteMany({ where: { id: utilisateurId } });
    await prisma.societe.deleteMany({ where: { id: societeId } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

async function articleEnStock(
  tarif: { uniteId: number; prixHT: number; quantiteConditionnement: number } | null,
  quantiteBase: number
) {
  const article = await prisma.article.create({
    data: { nom: `DASHBOARD-STOCK ${randomUUID()}`, type: "MATIERE_PREMIERE", categorieId, tvaId, societeId },
  });
  articleIds.push(article.id);
  if (tarif) {
    await prisma.tarifArticle.create({
      data: { articleId: article.id, fournisseurId, conditionnementId, actif: true, ...tarif },
    });
  }
  await prisma.stock.create({ data: { articleId: article.id, depotId, quantite: quantiteBase } });
}

async function valeurStock(): Promise<number> {
  const reponse = await fetch(`${baseUrl}/api/dashboard`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(reponse.status, 200);
  return ((await reponse.json()) as { valeurStock: number }).valeurStock;
}

async function viderStock() {
  await prisma.stock.deleteMany({ where: { articleId: { in: articleIds } } });
}

test("5 kg (5000 g en stock) d'un article à 10 € le kg valent 50 €", async () => {
  await viderStock();
  await articleEnStock({ uniteId: uniteKgId, prixHT: 10, quantiteConditionnement: 1 }, 5000);
  assert.equal(await valeurStock(), 50);
});

test("conditionnement : 2,5 kg d'un article vendu 65 € le carton de 10 kg valent 16,25 €", async () => {
  await viderStock();
  await articleEnStock({ uniteId: uniteKgId, prixHT: 65, quantiteConditionnement: 10 }, 2500);
  assert.ok(Math.abs((await valeurStock()) - 16.25) < 1e-9);
});

test("tarif déjà exprimé en unité de base (g) : 300 g à 0,02 € le gramme valent 6 €", async () => {
  await viderStock();
  await articleEnStock({ uniteId: uniteGrammeId, prixHT: 0.02, quantiteConditionnement: 1 }, 300);
  assert.ok(Math.abs((await valeurStock()) - 6) < 1e-9);
});

test("un article sans tarif ou au tarif inexploitable ne fausse ni ne bloque le total", async () => {
  await viderStock();
  await articleEnStock({ uniteId: uniteKgId, prixHT: 10, quantiteConditionnement: 1 }, 1000); // 10 €
  await articleEnStock(null, 4000); // sans tarif : ignoré
  await articleEnStock({ uniteId: uniteKgId, prixHT: 10, quantiteConditionnement: 0 }, 2000); // inexploitable : ignoré
  assert.equal(await valeurStock(), 10);
});
