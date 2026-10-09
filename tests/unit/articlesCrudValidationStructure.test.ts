import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Chantier CONSULTING RESTAURATION PRO — ARTICLES CRUD : POST /articles et PUT /articles/:id
// enveloppent déjà TOUTE leur écriture (article + allergènes + nutrition + tarif/fournisseur +
// stock) dans un seul prisma.$transaction(async (tx) => {...}) — un crash n'importe où dans ce
// bloc annule donc tout (pas de défaut d'atomicité ici, contrairement aux chantiers précédents
// F09/F10 sur les imports). Deux classes de défauts réels identifiées empiriquement :
//
// 1. Un mauvais TYPE (jamais un mauvais id REPRÉSENTABLE : un id dans les bornes INT4 mais
//    inexistant ou d'une autre société est déjà renvoyé en 400/404 par repondreErreurEcriture via
//    P2003/P2025/le contrôle dédié de categorieId — TVA/Unite/Allergene sont des tables de
//    référence globales, aucune colonne societeId dans prisma/schema.prisma, donc pas de concept
//    de "relation d'une autre société" pour elles) provoque une PrismaClientValidationError ou une
//    TypeError non interceptée (fournisseurNom non-chaîne : (123).trim() n'est pas une fonction).
// 2. Un entier hors des bornes réelles du stockage Postgres (INT4 : -2147483648 à 2147483647,
//    colonne `id` de Article/Categorie/TVA/Unite/Allergene) PASSE la validation de type (Zod .int(),
//    PrismaClientValidationError) mais provoque un ConnectorError levé par le driver Postgres
//    lui-même — confirmé empiriquement avec 2147483648 et 9007199254740991 (Number.MAX_SAFE_INTEGER)
//    sur categorieId/tvaId/uniteId/allergeneIds ET sur l'id d'URL de PUT /:id.
//
// Dans les deux cas, jamais classées P2003/P2025/P2002, donc jamais traduites en 400/404/409 par
// repondreErreurEcriture, et qui tombaient en 500 générique.
//
// Correctif : typage Zod minimal (categorieId/tvaId/uniteId/allergeneIds/reference/fournisseurNom)
// borné aux limites réelles du stockage (ID_POSTGRES_MIN/MAX dans server/routes/articles.ts) +
// garde-fou identique sur l'id d'URL de PUT — un id structurellement valide (dans ces bornes) mais
// inexistant continue d'emprunter exactement le même chemin (400/404) qu'avant, vérifié
// empiriquement avec 2147483647 (borne haute valide). Les valeurs null historiquement tolérées
// (fournisseurNom, reference, uniteId — vérifié empiriquement : aucune des trois ne crashait avec
// une valeur null explicite avant ce correctif) restent acceptées à l'identique. `reference` n'est
// PAS passé par .trim() dans le schéma Zod : le code base enregistre la référence BRUTE telle que
// saisie (seule la recherche de doublons compare une copie normalisée, sans jamais modifier la
// valeur écrite en base) — un .trim() dans le schéma aurait silencieusement altéré ce qui est
// enregistré par rapport au comportement historique.

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

function payloadBase(nom: string) {
  return { nom, categorieId, tvaId, rendement: 100, type: "MATIERE_PREMIERE" };
}

async function creerArticleDeTest(nom: string) {
  const article = await prisma.article.create({
    data: { nom, categorieId, tvaId, societeId, type: "MATIERE_PREMIERE" },
  });
  articleIds.push(article.id);
  return article;
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
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const unite = (await prisma.unite.findFirst()) ?? (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteId = unite.id;
  if (!(await prisma.conditionnement.findFirst())) {
    await prisma.conditionnement.create({ data: { nom: "Unité" } });
  }
});

after(async () => {
  const articlesASupprimer = await prisma.article.findMany({
    where: { OR: [{ id: { in: articleIds } }, { nom: { startsWith: "ARTICLES CRUD VALIDATION TEST" } }] },
    select: { id: true },
  });
  const idsASupprimer = articlesASupprimer.map((a) => a.id);
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: idsASupprimer } } });
  await prisma.valeurNutritionnelle.deleteMany({ where: { articleId: { in: idsASupprimer } } });
  await prisma.articleAllergene.deleteMany({ where: { articleId: { in: idsASupprimer } } });
  await prisma.article.deleteMany({ where: { id: { in: idsASupprimer } } });
  await prisma.fournisseur.deleteMany({ where: { nom: { startsWith: "ARTICLES CRUD VALIDATION TEST" } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

// --- A. fournisseurNom de type malformé : GREEN, 400 propre, rien créé (transaction annulée) ---

test("GREEN A1 : POST /articles avec fournisseurNom numérique (123) -> 400, rien créé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST A1 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), uniteId, prixHT: 10, fournisseurNom: 12345 }),
  });
  assert.equal(reponse.status, 400, "GREEN : plus de 500 pour un fournisseurNom numérique");
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null, "transaction annulée : aucun article créé malgré l'échec plus loin dans le bloc");
});

test("GREEN A2 : POST /articles avec fournisseurNom objet ({}) -> 400, rien créé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST A2 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), uniteId, prixHT: 10, fournisseurNom: {} }),
  });
  assert.equal(reponse.status, 400);
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});

test("GREEN A3 : PUT /articles/:id avec fournisseurNom numérique (123) -> 400, article intégralement inchangé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST A3 ${randomUUID()}`;
  const nomTenteDansLePUT = `ARTICLES CRUD VALIDATION TEST A3 NOM DIFFERENT ${randomUUID()}`;
  const article = await creerArticleDeTest(nom);
  const avant = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nomTenteDansLePUT), uniteId, prixHT: 10, fournisseurNom: 12345 }),
  });
  assert.equal(reponse.status, 400);
  const apres = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.deepEqual(apres, avant, "l'article complet (y compris nom) doit rester strictement identique, même si le PUT tentait de le renommer");
  const tarifs = await prisma.tarifArticle.count({ where: { articleId: article.id } });
  assert.equal(tarifs, 0, "aucun tarif créé : le rejet a lieu avant toute écriture de tarif");
});

test("GREEN A4 : POST /articles avec fournisseurNom null -> comportement historique préservé (traité comme non renseigné, jamais rejeté)", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST A4 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), uniteId, prixHT: 10, fournisseurNom: null }),
  });
  assert.equal(reponse.status, 201, "null n'a jamais crashé avant ce correctif, et ne doit pas devenir un refus");
});

// --- B. categorieId de mauvais type ---

test("GREEN B1 : POST /articles avec categorieId chaîne (\"abc\") -> 400, rien créé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST B1 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), categorieId: "abc" }),
  });
  assert.equal(reponse.status, 400);
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});

test("GREEN B2 : PUT /articles/:id avec categorieId chaîne (\"abc\") -> 400, article intégralement inchangé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST B2 ${randomUUID()}`;
  const nomTenteDansLePUT = `ARTICLES CRUD VALIDATION TEST B2 NOM DIFFERENT ${randomUUID()}`;
  const article = await creerArticleDeTest(nom);
  const avant = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nomTenteDansLePUT), categorieId: "abc" }),
  });
  assert.equal(reponse.status, 400);
  const apres = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.deepEqual(apres, avant, "l'article complet (y compris nom) doit rester strictement identique");
});

test("GREEN B3 : POST /articles sans la clé categorieId -> 400 (obligatoire à la création), rien créé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST B3 ${randomUUID()}`;
  const payloadSansCategorie = { nom, tvaId, rendement: 100, type: "MATIERE_PREMIERE" };
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadSansCategorie),
  });
  assert.equal(reponse.status, 400, "plus de 500 ; categorieId omis est désormais une erreur de validation claire, jamais un article créé avec une catégorie arbitraire d'une autre ligne");
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});

test("GREEN B4 : PUT /articles/:id sans la clé categorieId -> catégorie existante conservée (non-régression)", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST B4 ${randomUUID()}`;
  const article = await creerArticleDeTest(nom);
  const payloadSansCategorie = { nom, tvaId, rendement: 100, type: "MATIERE_PREMIERE" };
  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payloadSansCategorie),
  });
  assert.equal(reponse.status, 200);
  const relu = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(relu.categorieId, categorieId, "la catégorie existante doit rester inchangée quand la clé est omise");
});

test("GREEN B5 : PUT /articles/:id avec categorieId explicitement null -> 400, article intégralement inchangé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST B5 ${randomUUID()}`;
  const nomTenteDansLePUT = `ARTICLES CRUD VALIDATION TEST B5 NOM DIFFERENT ${randomUUID()}`;
  const article = await creerArticleDeTest(nom);
  const avant = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nomTenteDansLePUT), categorieId: null }),
  });
  assert.equal(reponse.status, 400);
  const apres = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.deepEqual(apres, avant, "l'article complet (y compris nom) doit rester strictement identique, jamais une catégorie effacée");
});

// --- C. tvaId de mauvais type / inexistant (POST uniquement) ---

test("GREEN C1 : POST /articles avec tvaId chaîne (\"abc\") -> 400, rien créé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST C1 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), tvaId: "abc" }),
  });
  assert.equal(reponse.status, 400);
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});

test("GREEN C2 : POST /articles avec tvaId inexistant (type valide) -> 400 (déjà sûr avant ce correctif, non-régression)", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST C2 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), tvaId: 999999999 }),
  });
  assert.equal(reponse.status, 400);
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});

// --- D. uniteId de mauvais type / inexistant / null ---

test("GREEN D1 : POST /articles avec uniteId chaîne (\"abc\") et prixHT -> 400, rien créé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST D1 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), uniteId: "abc", prixHT: 10 }),
  });
  assert.equal(reponse.status, 400);
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});

test("GREEN D2 : POST /articles avec uniteId inexistant (type valide) et prixHT -> 400 (déjà sûr, non-régression)", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST D2 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), uniteId: 999999999, prixHT: 10 }),
  });
  assert.equal(reponse.status, 400);
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});

test("GREEN D3 : POST /articles avec uniteId null -> comportement historique préservé (aucun tarif créé, pas de crash, article créé normalement)", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST D3 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), uniteId: null, prixHT: 10 }),
  });
  assert.equal(reponse.status, 201);
  const article = await prisma.article.findFirstOrThrow({ where: { nom, societeId } });
  const tarifs = await prisma.tarifArticle.count({ where: { articleId: article.id } });
  assert.equal(tarifs, 0, "uniteId null a toujours été traité comme absent (if (uniteId && ...)) : aucun tarif ne doit être créé");
});

// --- E. allergeneIds avec élément de mauvais type / id inexistant ---

test("GREEN E1 : POST /articles avec allergeneIds contenant une chaîne (\"abc\") -> 400, rien créé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST E1 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), allergeneIds: ["abc"] }),
  });
  assert.equal(reponse.status, 400);
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});

test("GREEN E2 : POST /articles avec allergeneIds contenant un id inexistant (type valide) -> 400 (déjà sûr, non-régression)", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST E2 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), allergeneIds: [999999999] }),
  });
  assert.equal(reponse.status, 400);
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});

// --- F. reference de mauvais type / null / omise ---

test("GREEN F1 : POST /articles avec reference numérique (12345) -> 400, rien créé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST F1 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), reference: 12345 }),
  });
  assert.equal(reponse.status, 400);
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});

test("GREEN F2 : PUT /articles/:id avec reference objet ({}) -> 400, article intégralement inchangé", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST F2 ${randomUUID()}`;
  const nomTenteDansLePUT = `ARTICLES CRUD VALIDATION TEST F2 NOM DIFFERENT ${randomUUID()}`;
  const article = await creerArticleDeTest(nom);
  const avant = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nomTenteDansLePUT), reference: {} }),
  });
  assert.equal(reponse.status, 400);
  const apres = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.deepEqual(apres, avant, "l'article complet (y compris nom) doit rester strictement identique");
});

test("GREEN F3 : PUT /articles/:id avec reference explicitement null -> comportement historique préservé (efface la référence)", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST F3 ${randomUUID()}`;
  const article = await prisma.article.create({
    data: { nom, reference: "REF-INITIALE", categorieId, tvaId, societeId, type: "MATIERE_PREMIERE" },
  });
  articleIds.push(article.id);
  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), reference: null }),
  });
  assert.equal(reponse.status, 200, "null doit toujours effacer la référence, jamais être refusé");
  const relu = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(relu.reference, null);
});

test("GREEN F4 : POST /articles avec reference entourée d'espaces -> enregistrée BRUTE, jamais trim (le schéma Zod ne normalise plus ce champ)", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST F4 ${randomUUID()}`;
  const referenceAvecEspaces = "  REF-BRUTE-001  ";
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), reference: referenceAvecEspaces }),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  articleIds.push(corps.id);
  assert.equal(corps.reference, referenceAvecEspaces, "la référence renvoyée doit conserver les espaces exactement comme saisis");
  const relu = await prisma.article.findUniqueOrThrow({ where: { id: corps.id } });
  assert.equal(relu.reference, referenceAvecEspaces, "la référence en base doit conserver les espaces exactement comme saisis");
});

test("GREEN F5 : PUT /articles/:id avec reference entourée d'espaces -> enregistrée BRUTE, jamais trim", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST F5 ${randomUUID()}`;
  const article = await creerArticleDeTest(nom);
  const referenceAvecEspaces = "  REF-BRUTE-002  ";
  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), reference: referenceAvecEspaces }),
  });
  assert.equal(reponse.status, 200);
  const relu = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(relu.reference, referenceAvecEspaces, "la référence en base doit conserver les espaces exactement comme saisis");
});

test("GREEN F6 : la recherche de doublons compare une référence normalisée MAIS écrit la valeur brute (espaces conservés) pour la ligne réellement créée", async () => {
  const nomExistant = `ARTICLES CRUD VALIDATION TEST F6 Existant ${randomUUID()}`;
  const referenceExistante = "REF-DOUBLON-F6";
  const articleExistant = await prisma.article.create({
    data: { nom: nomExistant, reference: referenceExistante, categorieId, tvaId, societeId, type: "MATIERE_PREMIERE" },
  });
  articleIds.push(articleExistant.id);

  const nomNouveau = `ARTICLES CRUD VALIDATION TEST F6 Nouveau ${randomUUID()}`;
  const referenceAvecEspaces = "  ref-doublon-f6  "; // même référence après trim + casse-insensible
  const reponseSansConfirmation = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nomNouveau), reference: referenceAvecEspaces }),
  });
  assert.equal(reponseSansConfirmation.status, 409, "la comparaison normalisée doit détecter le doublon malgré les espaces et la casse");

  const reponseAvecConfirmation = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nomNouveau), reference: referenceAvecEspaces, confirmationArticleId: articleExistant.id }),
  });
  assert.equal(reponseAvecConfirmation.status, 201, "la confirmation doit permettre la création malgré le doublon détecté");
  const corps = await reponseAvecConfirmation.json();
  articleIds.push(corps.id);
  assert.equal(corps.reference, referenceAvecEspaces, "la ligne réellement écrite garde la référence BRUTE (espaces + casse), jamais la version normalisée utilisée pour la comparaison");
});

test("GREEN F7 : POST /articles sans la clé reference -> article créé avec reference null (comportement absent)", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST F7 ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase(nom)),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  articleIds.push(corps.id);
  assert.equal(corps.reference, null, "reference omise à la création -> null, jamais une chaîne vide inventée");
});

test("GREEN F8 : PUT /articles/:id sans la clé reference -> référence existante conservée (comportement absent, mise à jour partielle)", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST F8 ${randomUUID()}`;
  const article = await prisma.article.create({
    data: { nom, reference: "REF-A-CONSERVER", categorieId, tvaId, societeId, type: "MATIERE_PREMIERE" },
  });
  articleIds.push(article.id);
  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase(nom)),
  });
  assert.equal(reponse.status, 200);
  const relu = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(relu.reference, "REF-A-CONSERVER", "reference omise en modification -> valeur existante inchangée, jamais effacée");
});

// --- G. id de l'URL malformé (PUT) ---

test("GREEN G1 : PUT /articles/abc (id non numérique) -> 400", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles/abc`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("peu importe")),
  });
  assert.equal(reponse.status, 400);
});

test("GREEN G2 : PUT /articles/999999999999999999999 (id hors bornes) -> 400", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles/999999999999999999999`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("peu importe")),
  });
  assert.equal(reponse.status, 400);
});

test("GREEN G3 : PUT /articles/:id avec un id valide mais inexistant -> 404 (inchangé)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles/999999999`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("peu importe")),
  });
  assert.equal(reponse.status, 404);
});

// --- H. bornes réelles du stockage (Postgres INT4 : -2147483648 à 2147483647) — RED empirique :
// 2147483648 et 9007199254740991 (Number.MAX_SAFE_INTEGER) passaient la validation de type (Zod
// .int() / contrôle client Prisma) mais provoquaient un ConnectorError du driver Postgres lui-même
// (jamais classé P2003/P2025, donc un 500) sur l'id d'URL de PUT ET sur categorieId/tvaId/uniteId/
// allergeneIds en POST. 2147483647 (borne haute valide) continue de fonctionner comme avant : un id
// représentable mais inexistant reste 400/404, jamais un crash.

test("GREEN H1 : PUT /articles/2147483647 (borne haute INT4 valide, inexistant) -> 404 (inchangé)", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles/2147483647`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("peu importe")),
  });
  assert.equal(reponse.status, 404);
});

test("GREEN H2 : PUT /articles/2147483648 (1 au-dessus de la borne INT4) -> 400, jamais 500", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles/2147483648`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("peu importe")),
  });
  assert.equal(reponse.status, 400);
});

test("GREEN H3 : PUT /articles/9007199254740991 (Number.MAX_SAFE_INTEGER, hors INT4) -> 400, jamais 500", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles/9007199254740991`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payloadBase("peu importe")),
  });
  assert.equal(reponse.status, 400);
});

test("GREEN H4 : POST /articles avec categorieId/tvaId/uniteId/allergeneIds = 2147483648 -> 400, jamais 500, rien créé", async () => {
  const valeur = 2147483648;
  for (const champ of ["categorieId", "tvaId", "uniteId", "allergeneIds"] as const) {
    const nom = `ARTICLES CRUD VALIDATION TEST H4 ${champ} ${randomUUID()}`;
    const payload: Record<string, unknown> =
      champ === "allergeneIds" ? { ...payloadBase(nom), allergeneIds: [valeur] } : { ...payloadBase(nom), [champ]: valeur };
    if (champ === "uniteId") payload.prixHT = 10;
    const reponse = await fetch(`${baseUrl}/api/articles`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    assert.equal(reponse.status, 400, `${champ}=${valeur} doit être refusé en 400, jamais un 500`);
    const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
    assert.equal(articleCree, null, `${champ}=${valeur} ne doit créer aucun article`);
  }
});

test("GREEN H5 : POST /articles avec categorieId/tvaId/uniteId/allergeneIds = 9007199254740991 -> 400, jamais 500, rien créé", async () => {
  const valeur = 9007199254740991;
  for (const champ of ["categorieId", "tvaId", "uniteId", "allergeneIds"] as const) {
    const nom = `ARTICLES CRUD VALIDATION TEST H5 ${champ} ${randomUUID()}`;
    const payload: Record<string, unknown> =
      champ === "allergeneIds" ? { ...payloadBase(nom), allergeneIds: [valeur] } : { ...payloadBase(nom), [champ]: valeur };
    if (champ === "uniteId") payload.prixHT = 10;
    const reponse = await fetch(`${baseUrl}/api/articles`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    assert.equal(reponse.status, 400, `${champ}=${valeur} doit être refusé en 400, jamais un 500`);
    const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
    assert.equal(articleCree, null, `${champ}=${valeur} ne doit créer aucun article`);
  }
});

test("GREEN H6 : POST /articles avec categorieId/tvaId/uniteId/allergeneIds = 2147483647 (borne haute valide, inexistant) -> 400 (déjà sûr, non-régression)", async () => {
  const valeur = 2147483647;
  for (const champ of ["categorieId", "tvaId", "uniteId", "allergeneIds"] as const) {
    const nom = `ARTICLES CRUD VALIDATION TEST H6 ${champ} ${randomUUID()}`;
    const payload: Record<string, unknown> =
      champ === "allergeneIds" ? { ...payloadBase(nom), allergeneIds: [valeur] } : { ...payloadBase(nom), [champ]: valeur };
    if (champ === "uniteId") payload.prixHT = 10;
    const reponse = await fetch(`${baseUrl}/api/articles`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    assert.equal(reponse.status, 400, `${champ}=${valeur} (inexistant) doit rester 400, non-régression`);
    const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
    assert.equal(articleCree, null, `${champ}=${valeur} (inexistant) ne doit créer aucun article`);
  }
});

// --- Isolation société : vérifie qu'aucun correctif ci-dessus n'affaiblit le cloisonnement existant ---

test("GREEN — isolation société : PUT sur un article d'une autre société reste 404, jamais modifié", async () => {
  const autreSociete = await prisma.societe.create({ data: { nom: `ARTICLES CRUD VALIDATION TEST Autre Societe ${randomUUID()}` } });
  const autreCategorie = await prisma.categorie.create({ data: { nom: "Cat autre société", societeId: autreSociete.id } });
  let autreArticleId: number | null = null;
  try {
    const autreArticle = await prisma.article.create({
      data: { nom: "Article autre société", categorieId: autreCategorie.id, tvaId, societeId: autreSociete.id, type: "MATIERE_PREMIERE" },
    });
    autreArticleId = autreArticle.id;

    const reponse = await fetch(`${baseUrl}/api/articles/${autreArticle.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(payloadBase("tentative de modification")),
    });
    assert.equal(reponse.status, 404);

    const relu = await prisma.article.findUniqueOrThrow({ where: { id: autreArticle.id } });
    assert.equal(relu.nom, "Article autre société");
  } finally {
    if (autreArticleId !== null) await prisma.article.delete({ where: { id: autreArticleId } }).catch(() => {});
    await prisma.categorie.delete({ where: { id: autreCategorie.id } }).catch(() => {});
    await prisma.societe.delete({ where: { id: autreSociete.id } }).catch(() => {});
  }
});

// --- categorieId d'une autre société : jamais acceptée, ni en création ni en modification ---

test("GREEN — categorieId d'une autre société : POST -> 400, aucun article créé", async () => {
  const autreSociete = await prisma.societe.create({ data: { nom: `ARTICLES CRUD VALIDATION TEST Categorie Etrangere Societe ${randomUUID()}` } });
  const autreCategorie = await prisma.categorie.create({ data: { nom: "Cat étrangère POST", societeId: autreSociete.id } });
  try {
    const nom = `ARTICLES CRUD VALIDATION TEST CATEGORIE ETRANGERE POST ${randomUUID()}`;
    const reponse = await fetch(`${baseUrl}/api/articles`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...payloadBase(nom), categorieId: autreCategorie.id }),
    });
    assert.equal(reponse.status, 400, "une catégorie d'une autre société ne doit jamais être acceptée à la création");
    const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
    assert.equal(articleCree, null);
  } finally {
    await prisma.categorie.delete({ where: { id: autreCategorie.id } }).catch(() => {});
    await prisma.societe.delete({ where: { id: autreSociete.id } }).catch(() => {});
  }
});

test("GREEN — categorieId d'une autre société : PUT sur notre propre article -> 400, article intégralement inchangé", async () => {
  const autreSociete = await prisma.societe.create({ data: { nom: `ARTICLES CRUD VALIDATION TEST Categorie Etrangere Societe PUT ${randomUUID()}` } });
  const autreCategorie = await prisma.categorie.create({ data: { nom: "Cat étrangère PUT", societeId: autreSociete.id } });
  try {
    const nom = `ARTICLES CRUD VALIDATION TEST CATEGORIE ETRANGERE PUT ${randomUUID()}`;
    const nomTenteDansLePUT = `ARTICLES CRUD VALIDATION TEST CATEGORIE ETRANGERE PUT NOM DIFFERENT ${randomUUID()}`;
    const article = await creerArticleDeTest(nom);
    const avant = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ ...payloadBase(nomTenteDansLePUT), categorieId: autreCategorie.id }),
    });
    assert.equal(reponse.status, 400, "une catégorie d'une autre société ne doit jamais être acceptée en modification, même sur notre propre article");
    const apres = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    assert.deepEqual(apres, avant, "l'article complet (y compris nom) doit rester strictement identique");
  } finally {
    await prisma.categorie.delete({ where: { id: autreCategorie.id } }).catch(() => {});
    await prisma.societe.delete({ where: { id: autreSociete.id } }).catch(() => {});
  }
});

// --- Régression : créations/modifications valides inchangées ---

test("GREEN — régression : POST /articles valide avec tarif et allergène toujours fonctionnel", async () => {
  const allergene =
    (await prisma.allergene.findFirst()) ?? (await prisma.allergene.create({ data: { nom: "Gluten test", code: `GLUTEN-TEST-${randomUUID()}` } }));
  const nom = `ARTICLES CRUD VALIDATION TEST REGRESSION POST ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/articles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), uniteId, prixHT: 15, reference: "REF-OK", allergeneIds: [allergene.id] }),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  assert.equal(corps.reference, "REF-OK");
  articleIds.push(corps.id);

  const tarifs = await prisma.tarifArticle.count({ where: { articleId: corps.id } });
  assert.equal(tarifs, 1);
  const allergenes = await prisma.articleAllergene.count({ where: { articleId: corps.id } });
  assert.equal(allergenes, 1);
});

test("GREEN — régression : PUT /articles/:id valide (changement de prix/unité/référence) toujours fonctionnel", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST REGRESSION PUT ${randomUUID()}`;
  const article = await creerArticleDeTest(nom);
  const reponse = await fetch(`${baseUrl}/api/articles/${article.id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ ...payloadBase(nom), uniteId, prixHT: 20, reference: "REF-MODIFIEE" }),
  });
  assert.equal(reponse.status, 200);
  const relu = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(relu.reference, "REF-MODIFIEE");
  const tarifs = await prisma.tarifArticle.count({ where: { articleId: article.id, actif: true } });
  assert.equal(tarifs, 1);
});

// --- Panne interne simulée (fault injection, substitut d'une vraie panne DB) : ne doit jamais être
// maquillée en 400 ---

test("GREEN — une panne interne simulée sur POST /articles reste une erreur serveur (500), jamais maquillée en 400", async () => {
  const nom = `ARTICLES CRUD VALIDATION TEST PANNE ${randomUUID()}`;

  const originalTransaction = prisma.$transaction.bind(prisma);
  (prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = (async (
    arg: unknown,
    ...reste: unknown[]
  ) => {
    if (typeof arg !== "function") {
      return (originalTransaction as (...a: unknown[]) => unknown)(arg, ...reste);
    }
    return (originalTransaction as (...a: unknown[]) => unknown)(async (tx: unknown) => {
      const txArticle = (tx as { article: { create: (...args: unknown[]) => Promise<unknown> } }).article;
      txArticle.create = async () => {
        throw new Error("PANNE SIMULÉE (test CRUD articles) : échec déterministe confiné aux tests, jamais une panne réelle");
      };
      return (arg as (tx: unknown) => unknown)(tx);
    }, ...reste);
  }) as typeof prisma.$transaction;

  let statut: number;
  try {
    const reponse = await fetch(`${baseUrl}/api/articles`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payloadBase(nom)),
    });
    statut = reponse.status;
  } finally {
    (prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = originalTransaction;
  }

  assert.equal(statut, 500, "une panne DB/interne réelle ne doit jamais être maquillée en 400");
  const articleCree = await prisma.article.findFirst({ where: { nom, societeId } });
  assert.equal(articleCree, null);
});
