import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre POST /api/articles (app Express réelle, vrai Postgres) — voir
// tests/unit/articles.test.ts (validation PR #80, non modifié ici) pour le même principe.
//
// Objet de ce chantier : une référence déjà utilisée par un autre article actif ne doit plus jamais
// créer un second article silencieusement. Une confirmation, lorsqu'elle est nécessaire, doit être
// explicitement liée à l'articleId du doublon réévalué au moment de l'écriture — jamais un simple
// booléen, jamais une confirmation acceptée sans revérification fraîche côté serveur.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
const articleIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function payloadBase(nom: string, reference?: string | null) {
  return {
    nom,
    reference,
    categorieId,
    tvaId,
    societeId,
    rendement: 100,
    type: "MATIERE_PREMIERE",
  };
}

async function creerArticle(nom: string, reference?: string | null, confirmationArticleId?: number) {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom, reference), confirmationArticleId }),
  });
  const corps = await reponse.json();
  return { status: reponse.status, corps };
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
});

after(async () => {
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { nom: { startsWith: "DOUBLON REF TEST" } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("1. référence nouvelle : création normale", async () => {
  const { status, corps } = await creerArticle("DOUBLON REF TEST Article Unique", "DOUBLONREF-001");
  assert.equal(status, 201);
  articleIds.push(corps.id);
  assert.equal(corps.reference, "DOUBLONREF-001");
});

test("2. doublon de référence non confirmé : refus (409), aucune création", async () => {
  const premier = await creerArticle("DOUBLON REF TEST Original A", "DOUBLONREF-002");
  articleIds.push(premier.corps.id);
  const avant = await prisma.article.count();

  const { status, corps } = await creerArticle("DOUBLON REF TEST Doublon Non Confirme", "DOUBLONREF-002");
  assert.equal(status, 409);
  assert.match(corps.error, /référence/i);
  assert.equal(corps.doublons[0].id, premier.corps.id);

  const apres = await prisma.article.count();
  assert.equal(apres, avant, "aucun article ne doit avoir été créé");
});

test("3. doublon de référence explicitement confirmé (bon articleId) : création autorisée", async () => {
  const premier = await creerArticle("DOUBLON REF TEST Original B", "DOUBLONREF-003");
  articleIds.push(premier.corps.id);

  const { status, corps } = await creerArticle(
    "DOUBLON REF TEST Doublon Confirme",
    "DOUBLONREF-003",
    premier.corps.id
  );
  assert.equal(status, 201);
  articleIds.push(corps.id);
  assert.equal(corps.reference, "DOUBLONREF-003");

  const total = await prisma.article.count({ where: { reference: "DOUBLONREF-003", actif: true } });
  assert.equal(total, 2, "les deux articles doivent coexister, le doublon a été explicitement voulu");
});

test("4. confirmation désignant un AUTRE article : refus (409)", async () => {
  const premier = await creerArticle("DOUBLON REF TEST Original C", "DOUBLONREF-004");
  articleIds.push(premier.corps.id);
  const sansRapport = await creerArticle("DOUBLON REF TEST Sans Rapport", "DOUBLONREF-004-AUTRE");
  articleIds.push(sansRapport.corps.id);
  const avant = await prisma.article.count();

  const { status } = await creerArticle(
    "DOUBLON REF TEST Doublon Mauvais Id",
    "DOUBLONREF-004",
    sansRapport.corps.id
  );
  assert.equal(status, 409);

  const apres = await prisma.article.count();
  assert.equal(apres, avant, "aucun article ne doit avoir été créé");
});

test("5. tentative API directe sans confirmationArticleId : refus (409)", async () => {
  const premier = await creerArticle("DOUBLON REF TEST Original D", "DOUBLONREF-005");
  articleIds.push(premier.corps.id);

  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("DOUBLON REF TEST Bypass Direct", "DOUBLONREF-005")),
  });
  assert.equal(reponse.status, 409);
});

test("6. confirmation falsifiée (articleId inexistant) : refus (409)", async () => {
  const premier = await creerArticle("DOUBLON REF TEST Original E", "DOUBLONREF-006");
  articleIds.push(premier.corps.id);
  const avant = await prisma.article.count();

  const { status } = await creerArticle("DOUBLON REF TEST Confirmation Falsifiee", "DOUBLONREF-006", 999999999);
  assert.equal(status, 409);

  const apres = await prisma.article.count();
  assert.equal(apres, avant, "aucun article ne doit avoir été créé");
});

test("7. absence de référence : comportement actuel conservé, aucune vérification", async () => {
  const a = await creerArticle("DOUBLON REF TEST Sans Ref A", null);
  articleIds.push(a.corps.id);
  const b = await creerArticle("DOUBLON REF TEST Sans Ref B", null);
  articleIds.push(b.corps.id);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.corps.reference, null);
  assert.equal(b.corps.reference, null);
});

test("7bis. référence espaces uniquement, deux fois : comportement actuel conservé (non-régression)", async () => {
  const a = await creerArticle("DOUBLON REF TEST Espaces A", "   ");
  articleIds.push(a.corps.id);
  const b = await creerArticle("DOUBLON REF TEST Espaces B", "   ");
  articleIds.push(b.corps.id);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201, "une référence vide après trim n'est jamais traitée comme un doublon");
});

test("8. validations PR #80 toujours actives (non-régression) : nom vide toujours refusé (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("", "DOUBLONREF-008")),
  });
  assert.equal(reponse.status, 400, "la validation de PR #80 doit rester inchangée");
});

test("9. état périmé entre confirmation et écriture (article désactivé entretemps) : refus", async () => {
  const premier = await creerArticle("DOUBLON REF TEST Original Perime", "DOUBLONREF-009");
  articleIds.push(premier.corps.id);

  // L'état change entre la « prévisualisation » côté client et cet appel : l'article visé par la
  // confirmation est désactivé (ex. supprimé entretemps par un autre utilisateur).
  await prisma.article.update({ where: { id: premier.corps.id }, data: { actif: false } });

  const avant = await prisma.article.count();
  const { status } = await creerArticle("DOUBLON REF TEST Confirmation Perimee", "DOUBLONREF-009", premier.corps.id);
  // Plus aucun article actif ne porte cette référence : la ligne est réévaluée comme "aucun
  // doublon", donc la création réussit normalement (le doublon d'origine n'existe plus activement).
  assert.equal(status, 201);

  const apres = await prisma.article.count();
  assert.equal(apres, avant + 1);
});

test("10. plusieurs articles actifs partagent déjà la même référence : confirmer l'un d'eux suffit (aucun choix arbitraire)", async () => {
  const premier = await creerArticle("DOUBLON REF TEST Partage A", "DOUBLONREF-010");
  articleIds.push(premier.corps.id);
  const second = await creerArticle("DOUBLON REF TEST Partage B", "DOUBLONREF-010", premier.corps.id);
  articleIds.push(second.corps.id);
  assert.equal(second.status, 201);

  // Confirmer le SECOND (pas nécessairement le premier trouvé) doit aussi être accepté.
  const { status, corps } = await creerArticle("DOUBLON REF TEST Partage C", "DOUBLONREF-010", second.corps.id);
  assert.equal(status, 201);
  articleIds.push(corps.id);
});
