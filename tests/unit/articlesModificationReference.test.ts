import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre PUT /api/articles/:id et POST /api/articles (app Express réelle,
// vrai Postgres) — voir tests/unit/articlesDoublonReference.test.ts (PR #81, non modifié ici) pour
// le même principe appliqué à la création.
//
// Objet de ce chantier : PUT /articles/:id ne doit plus jamais pouvoir créer silencieusement un
// doublon de référence en modifiant un article vers la référence d'un autre article actif — même
// protection que POST (confirmationArticleId réévalué fraîchement au moment de l'écriture, jamais
// un simple booléen, jamais une liste transmise par le client). stockInitial négatif ne doit plus
// jamais être accepté ni écrit en base, en POST comme en PUT.

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

function payloadBase(nom: string, reference?: string | null, stockInitial?: unknown) {
  return {
    nom,
    reference,
    categorieId,
    tvaId,
    societeId,
    rendement: 100,
    type: "MATIERE_PREMIERE",
    ...(stockInitial !== undefined ? { stockInitial } : {}),
  };
}

async function creerArticle(
  nom: string,
  reference?: string | null,
  confirmationArticleId?: number,
  stockInitial?: unknown
) {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom, reference, stockInitial), confirmationArticleId }),
  });
  const corps = await reponse.json();
  return { status: reponse.status, corps };
}

async function modifierArticle(
  id: number,
  nom: string,
  reference?: string | null,
  confirmationArticleId?: number,
  stockInitial?: unknown
) {
  const reponse = await fetch(`${baseUrl}/api/articles/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom, reference, stockInitial), confirmationArticleId }),
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
  // Ordre imposé par les clés étrangères : Stock référence Article (Stock_articleId_fkey) — voir
  // les tests stockInitial (10-13) qui créent des lignes Stock réelles, jamais nettoyées ici sans
  // cet ordre.
  await prisma.stock.deleteMany({
    where: { article: { OR: [{ id: { in: articleIds } }, { nom: { startsWith: "MODIF REF TEST" } }] } },
  });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { nom: { startsWith: "MODIF REF TEST" } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("1. modification vers une référence libre : autorisée", async () => {
  const article = await creerArticle("MODIF REF TEST Libre", "MODIFREF-001");
  articleIds.push(article.corps.id);

  const { status, corps } = await modifierArticle(article.corps.id, "MODIF REF TEST Libre", "MODIFREF-001-BIS");
  assert.equal(status, 200);
  assert.equal(corps.reference, "MODIFREF-001-BIS");
});

test("2. modification en conservant sa propre référence : autorisée, aucune vérification bloquante", async () => {
  const article = await creerArticle("MODIF REF TEST Propre Ref", "MODIFREF-002");
  articleIds.push(article.corps.id);

  const { status, corps } = await modifierArticle(article.corps.id, "MODIF REF TEST Propre Ref Renomme", "MODIFREF-002");
  assert.equal(status, 200);
  assert.equal(corps.reference, "MODIFREF-002");
});

test("3. modification vers la référence d'un autre article actif, sans confirmation : refus (409)", async () => {
  const autre = await creerArticle("MODIF REF TEST Autre A", "MODIFREF-003");
  articleIds.push(autre.corps.id);
  const article = await creerArticle("MODIF REF TEST Cible A", "MODIFREF-003-LIBRE");
  articleIds.push(article.corps.id);

  const { status, corps } = await modifierArticle(article.corps.id, "MODIF REF TEST Cible A", "MODIFREF-003");
  assert.equal(status, 409);
  assert.match(corps.error, /référence/i);
  assert.equal(corps.doublons[0].id, autre.corps.id);
});

test("4. modification vers la référence d'un autre article, confirmée (bon articleId) : autorisée", async () => {
  const autre = await creerArticle("MODIF REF TEST Autre B", "MODIFREF-004");
  articleIds.push(autre.corps.id);
  const article = await creerArticle("MODIF REF TEST Cible B", "MODIFREF-004-LIBRE");
  articleIds.push(article.corps.id);

  const { status, corps } = await modifierArticle(
    article.corps.id,
    "MODIF REF TEST Cible B",
    "MODIFREF-004",
    autre.corps.id
  );
  assert.equal(status, 200);
  assert.equal(corps.reference, "MODIFREF-004");

  const total = await prisma.article.count({ where: { reference: "MODIFREF-004", actif: true } });
  assert.equal(total, 2, "les deux articles doivent coexister, le doublon a été explicitement voulu");
});

test("5. confirmation désignant un mauvais articleId : refus (409)", async () => {
  const autre = await creerArticle("MODIF REF TEST Autre C", "MODIFREF-005");
  articleIds.push(autre.corps.id);
  const sansRapport = await creerArticle("MODIF REF TEST Sans Rapport C", "MODIFREF-005-AUTRE");
  articleIds.push(sansRapport.corps.id);
  const article = await creerArticle("MODIF REF TEST Cible C", "MODIFREF-005-LIBRE");
  articleIds.push(article.corps.id);

  const { status } = await modifierArticle(
    article.corps.id,
    "MODIF REF TEST Cible C",
    "MODIFREF-005",
    sansRapport.corps.id
  );
  assert.equal(status, 409);
});

test("6. article confirmé devenu inactif entretemps : la référence n'est plus considérée en doublon, modification autorisée", async () => {
  const autre = await creerArticle("MODIF REF TEST Autre D", "MODIFREF-006");
  articleIds.push(autre.corps.id);
  const article = await creerArticle("MODIF REF TEST Cible D", "MODIFREF-006-LIBRE");
  articleIds.push(article.corps.id);

  await prisma.article.update({ where: { id: autre.corps.id }, data: { actif: false } });

  const { status, corps } = await modifierArticle(
    article.corps.id,
    "MODIF REF TEST Cible D",
    "MODIFREF-006",
    autre.corps.id
  );
  // Plus aucun article actif ne porte cette référence : la ligne est réévaluée comme "aucun
  // doublon", donc la modification réussit normalement (même principe que PR #81, test 9).
  assert.equal(status, 200);
  assert.equal(corps.reference, "MODIFREF-006");
});

test("7. refus (409) : aucune écriture en base, référence d'origine conservée", async () => {
  const autre = await creerArticle("MODIF REF TEST Autre F", "MODIFREF-007");
  articleIds.push(autre.corps.id);
  const article = await creerArticle("MODIF REF TEST Cible F", "MODIFREF-007-LIBRE");
  articleIds.push(article.corps.id);

  const { status } = await modifierArticle(article.corps.id, "MODIF REF TEST Cible F Renomme", "MODIFREF-007");
  assert.equal(status, 409);

  const enBase = await prisma.article.findUniqueOrThrow({ where: { id: article.corps.id } });
  assert.equal(enBase.reference, "MODIFREF-007-LIBRE", "la référence d'origine ne doit pas avoir changé");
  assert.equal(enBase.nom, "MODIF REF TEST Cible F", "le nom d'origine ne doit pas avoir changé non plus");
});

test("8. non-régression : POST /articles avec confirmation reste inchangé (comportement PR #81)", async () => {
  const premier = await creerArticle("MODIF REF TEST Regression POST", "MODIFREF-008");
  articleIds.push(premier.corps.id);

  const sansConfirmation = await creerArticle("MODIF REF TEST Regression POST Doublon", "MODIFREF-008");
  assert.equal(sansConfirmation.status, 409);

  const confirme = await creerArticle(
    "MODIF REF TEST Regression POST Doublon Confirme",
    "MODIFREF-008",
    premier.corps.id
  );
  assert.equal(confirme.status, 201);
  articleIds.push(confirme.corps.id);
});

test("9. stockInitial négatif en POST : refus (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("MODIF REF TEST Stock Negatif POST", "MODIFREF-009", -5)),
  });
  assert.equal(reponse.status, 400);

  const existe = await prisma.article.findFirst({ where: { nom: "MODIF REF TEST Stock Negatif POST" } });
  assert.equal(existe, null, "aucun article ne doit avoir été créé");
});

test("10. stockInitial négatif en PUT : refus (400), aucune écriture", async () => {
  const article = await creerArticle("MODIF REF TEST Stock Negatif PUT", "MODIFREF-010", undefined, 10);
  articleIds.push(article.corps.id);

  const { status } = await modifierArticle(
    article.corps.id,
    "MODIF REF TEST Stock Negatif PUT",
    "MODIFREF-010",
    undefined,
    -1
  );
  assert.equal(status, 400);

  const stock = await prisma.stock.findFirst({ where: { articleId: article.corps.id } });
  assert.ok(!stock || stock.quantite === 10, "le stock ne doit pas avoir été écrasé par une valeur négative");
});

test("11. stockInitial à zéro : autorisé, en POST et en PUT", async () => {
  const article = await creerArticle("MODIF REF TEST Stock Zero", "MODIFREF-011", undefined, 0);
  articleIds.push(article.corps.id);

  const { status } = await modifierArticle(
    article.corps.id,
    "MODIF REF TEST Stock Zero",
    "MODIFREF-011",
    undefined,
    0
  );
  assert.equal(status, 200);
});

test("12. stockInitial positif : autorisé, en POST et en PUT", async () => {
  const article = await creerArticle("MODIF REF TEST Stock Positif", "MODIFREF-012", undefined, 3.5);
  articleIds.push(article.corps.id);

  const { status } = await modifierArticle(
    article.corps.id,
    "MODIF REF TEST Stock Positif",
    "MODIFREF-012",
    undefined,
    7.25
  );
  assert.equal(status, 200);
});

test("13. stockInitial non numérique : refus (400), en POST et en PUT", async () => {
  const reponsePost = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("MODIF REF TEST Stock Non Numerique POST", "MODIFREF-013", "abc")),
  });
  assert.equal(reponsePost.status, 400);

  const article = await creerArticle("MODIF REF TEST Stock Non Numerique PUT", "MODIFREF-013-PUT", undefined, 1);
  articleIds.push(article.corps.id);

  const reponsePut = await fetch(`${baseUrl}/api/articles/${article.corps.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("MODIF REF TEST Stock Non Numerique PUT", "MODIFREF-013-PUT", "abc")),
  });
  assert.equal(reponsePut.status, 400);
});
