import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest, creerUtilisateurAutreSocieteDeTest } from "../helpers/auth.js";

// Faille confirmée (audit F09/F10, 2026-10-07) : POST /api/articles/rechercher-par-reference
// (server/routes/articles.ts) interrogeait `prisma.article.findMany({ where: { reference: {...},
// actif: true } })` SANS filtre societeId, alors que toutes les autres requêtes du même fichier en
// appliquent un systématiquement. Un utilisateur de n'importe quelle société pouvait ainsi obtenir
// nom/prix/unité d'un article d'une AUTRE société en devinant/énumérant sa référence. Ce fichier
// démontre que le correctif (ajout de `societeId: req.utilisateur!.societeId` au where) isole
// strictement les résultats par société.

const PREFIXE = "ISOLATION ARTICLES TEST";

let server: Server;
let baseUrl: string;
let token: string;
let categorieIdA: number;
let uniteId: number;
let tvaId: number;

function authHeaders(jeton: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` };
}

async function rechercherParReference(jeton: string, references: string[]) {
  const reponse = await fetch(`${baseUrl}/api/articles/rechercher-par-reference`, {
    method: "POST",
    headers: authHeaders(jeton),
    body: JSON.stringify({ references }),
  });
  return reponse.json();
}

async function creerArticleAvecTarif(
  jeton: string,
  categorieId: number,
  nom: string,
  reference: string,
  prixHT: number
) {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(jeton),
    body: JSON.stringify({
      nom,
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      reference,
      uniteId,
      prixHT,
    }),
  });
  const corps = await reponse.json();
  assert.equal(reponse.status, 201, `précondition de test : création de l'article "${nom}" doit réussir (${JSON.stringify(corps)})`);
  return corps;
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
  const categorie =
    (await prisma.categorie.findFirst({ where: { societeId: societe.id }, orderBy: { id: "asc" } })) ??
    (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId: societe.id } }));
  categorieIdA = categorie.id;

  const unite = (await prisma.unite.findFirst()) ?? (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteId = unite.id;

  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
});

after(async () => {
  const articles = await prisma.article.findMany({ where: { nom: { startsWith: PREFIXE } }, select: { id: true } });
  const ids = articles.map((a) => a.id);
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: ids } } });
  await prisma.article.deleteMany({ where: { id: { in: ids } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("A. société A recherche une référence qui lui appartient : trouvée avec ses propres données", async () => {
  const reference = `${PREFIXE}-REF-A-${randomUUID()}`;
  const articleA = await creerArticleAvecTarif(token, categorieIdA, `${PREFIXE} Article A`, reference, 10.5);

  const resultat = await rechercherParReference(token, [reference]);

  assert.equal(resultat.trouves.length, 1);
  assert.equal(resultat.trouves[0].articleId, articleA.id);
  assert.equal(resultat.trouves[0].nom, `${PREFIXE} Article A`);
  assert.equal(resultat.trouves[0].prixHT, 10.5);
});

test("B. société A recherche une référence qui n'existe QUE chez une autre société : aucun résultat", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const categorieB = await prisma.categorie.create({ data: { nom: "Catégorie B", societeId: autreSociete.societeId } });
  const reference = `${PREFIXE}-REF-B-SEUL-${randomUUID()}`;
  await creerArticleAvecTarif(autreSociete.token, categorieB.id, `${PREFIXE} Article B seul`, reference, 7.25);

  const resultat = await rechercherParReference(token, [reference]);

  assert.deepEqual(resultat.trouves, [], "une référence appartenant uniquement à une autre société ne doit jamais apparaître");
});

test("C. même référence présente chez société A et société B : seule la version de A est renvoyée à A", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const categorieB = await prisma.categorie.create({ data: { nom: "Catégorie B bis", societeId: autreSociete.societeId } });
  const reference = `${PREFIXE}-REF-PARTAGEE-${randomUUID()}`;

  const articleA = await creerArticleAvecTarif(token, categorieIdA, `${PREFIXE} Article A partagee`, reference, 15);
  const articleB = await creerArticleAvecTarif(autreSociete.token, categorieB.id, `${PREFIXE} Article B partagee SECRET`, reference, 999);

  const resultatPourA = await rechercherParReference(token, [reference]);

  assert.equal(resultatPourA.trouves.length, 1, "un seul résultat : celui de la société A, jamais les deux");
  assert.equal(resultatPourA.trouves[0].articleId, articleA.id);
  assert.equal(resultatPourA.trouves[0].prixHT, 15);

  // D. Aucun champ de l'article B (nom, id, prix) ne doit apparaître dans la réponse faite à A.
  const corpsSerialise = JSON.stringify(resultatPourA);
  assert.ok(!corpsSerialise.includes("SECRET"), "le nom de l'article de la société B ne doit jamais apparaître");
  assert.ok(!corpsSerialise.includes(String(articleB.id)), "l'id de l'article de la société B ne doit jamais apparaître");
  assert.ok(!corpsSerialise.includes("999"), "le prix de l'article de la société B ne doit jamais apparaître");

  // Contrôle symétrique : la société B, de son côté, ne voit que SA version.
  const resultatPourB = await rechercherParReference(autreSociete.token, [reference]);
  assert.equal(resultatPourB.trouves.length, 1);
  assert.equal(resultatPourB.trouves[0].articleId, articleB.id);
});
