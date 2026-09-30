import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";
import { normaliserTexte } from "../../server/utils/normaliserTexte.js";

// Test d'intégration réel (app Express réelle, vrai Postgres) pour le chantier « FK 500→400,
// portée transversale » : une violation de contrainte de clé étrangère (référence à un
// enregistrement inexistant) doit désormais être refusée en 400 par server/utils/erreursEcriture.ts
// (repondreErreurEcriture), sur les 7 routeurs concernés — jamais en 500. Aucune écriture ne doit
// avoir lieu dans ces cas.
//
// Périmètre volontairement limité aux violations de contrainte Postgres (code Prisma P2003) :
// les erreurs métier levées manuellement ailleurs (ex. portions <= 0 dans coutRecette.ts, déjà
// classées comportement correct par les chantiers précédents et verrouillées par
// tests/unit/recettes.test.ts) restent inchangées en 500 — un test de non-régression le vérifie
// explicitement ci-dessous.

const ID_INEXISTANT = 999999999;

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let articleId: number;
let recetteExistanteId: number;
const idsRecette: number[] = [];
const idsMenu: number[] = [];
const idsSousCategorie: number[] = [];
const idsDepot: number[] = [];
const idsFournisseur: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function poster(chemin: string, corpsPayload: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}${chemin}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsPayload),
  });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
}

async function mettreAJour(chemin: string, corpsPayload: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}${chemin}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(corpsPayload),
  });
  const corps = await reponse.json().catch(() => null);
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

  token = await connecterAdminDeTest(baseUrl);

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;

  const article = await prisma.article.create({
    data: {
      nom: "ERREURS FK TEST Article",
      reference: "ERRFKTEST-001",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      type: "MATIERE_PREMIERE",
    },
  });
  articleId = article.id;

  const recette = await prisma.recette.create({
    data: { nom: "ERREURS FK TEST Recette Base", societeId, portions: 2 },
  });
  recetteExistanteId = recette.id;
  idsRecette.push(recette.id);
});

after(async () => {
  await prisma.recetteLigne.deleteMany({ where: { recetteId: { in: idsRecette } } });
  await prisma.recetteLigne.deleteMany({ where: { recette: { nom: { startsWith: "ERREURS FK TEST" } } } });
  await prisma.menuLigne.deleteMany({ where: { menuId: { in: idsMenu } } });
  await prisma.menu.deleteMany({ where: { id: { in: idsMenu } } });
  await prisma.menu.deleteMany({ where: { nom: { startsWith: "ERREURS FK TEST" } } });
  await prisma.recette.deleteMany({ where: { id: { in: idsRecette } } });
  await prisma.recette.deleteMany({ where: { nom: { startsWith: "ERREURS FK TEST" } } });
  await prisma.sousCategorieRecette.deleteMany({ where: { id: { in: idsSousCategorie } } });
  await prisma.sousCategorieRecette.deleteMany({ where: { nom: { startsWith: "ERREURS FK TEST" } } });
  await prisma.depot.deleteMany({ where: { id: { in: idsDepot } } });
  await prisma.depot.deleteMany({ where: { nom: { startsWith: "ERREURS FK TEST" } } });
  await prisma.fournisseur.deleteMany({ where: { id: { in: idsFournisseur } } });
  await prisma.fournisseur.deleteMany({ where: { nom: { startsWith: "ERREURS FK TEST" } } });
  await prisma.article.delete({ where: { id: articleId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

// Depuis le chantier isolation société : societeId n'est plus jamais lu depuis req.body (toujours
// dérivé du compte connecté, voir Utilisateur/RoleUtilisateur, prisma/schema.prisma) — un
// societeId inexistant transmis par le client est donc simplement ignoré, jamais une cause de
// violation FK : la création réussit, avec le societeId réel du compte connecté.
test("1. POST /depots : un societeId transmis par le client est ignoré, la création utilise la société connectée", async () => {
  const { status, corps } = await poster("/api/depots", { nom: "ERREURS FK TEST Depot", societeId: ID_INEXISTANT });
  assert.equal(status, 201);
  assert.equal(corps.societeId, societeId);
  idsDepot.push(corps.id);
});

test("2. POST /fournisseurs : un societeId transmis par le client est ignoré, la création utilise la société connectée", async () => {
  const { status, corps } = await poster("/api/fournisseurs", { nom: "ERREURS FK TEST Fournisseur", societeId: ID_INEXISTANT });
  assert.equal(status, 201);
  assert.equal(corps.societeId, societeId);
  idsFournisseur.push(corps.id);
});

test("3. POST /sous-categories-recette avec parentId inexistant : 400, aucune écriture", async () => {
  const { status } = await poster("/api/sous-categories-recette", { nom: "ERREURS FK TEST SousCategorie", parentId: ID_INEXISTANT });
  assert.equal(status, 400);
  const cree = await prisma.sousCategorieRecette.findFirst({ where: { nom: "ERREURS FK TEST SousCategorie" } });
  assert.equal(cree, null, "aucune sous-catégorie ne doit avoir été créée");
});

test("4. PUT /sous-categories-recette/:id avec parentId inexistant : 400, valeur d'origine conservée", async () => {
  const base = await prisma.sousCategorieRecette.create({ data: { nom: "ERREURS FK TEST SousCategorie Base" } });
  idsSousCategorie.push(base.id);

  const { status } = await mettreAJour(`/api/sous-categories-recette/${base.id}`, { nom: "ERREURS FK TEST SousCategorie Renommee", parentId: ID_INEXISTANT });
  assert.equal(status, 400);

  const enBase = await prisma.sousCategorieRecette.findUniqueOrThrow({ where: { id: base.id } });
  assert.equal(enBase.nom, "ERREURS FK TEST SousCategorie Base");
  assert.equal(enBase.parentId, null);
});

test("5. POST /menus : un societeId transmis par le client est ignoré, la création utilise la société connectée", async () => {
  const { status, corps } = await poster("/api/menus", { nom: "ERREURS FK TEST Menu Societe", societeId: ID_INEXISTANT, lignes: [] });
  assert.equal(status, 201);
  assert.equal(corps.societeId, societeId);
  idsMenu.push(corps.id);
});

test("6. POST /menus avec categorieId inexistant : 400, aucune écriture", async () => {
  const { status } = await poster("/api/menus", { nom: "ERREURS FK TEST Menu Categorie", societeId, categorieId: ID_INEXISTANT, lignes: [] });
  assert.equal(status, 400);
  const cree = await prisma.menu.findFirst({ where: { nom: "ERREURS FK TEST Menu Categorie" } });
  assert.equal(cree, null, "aucun menu ne doit avoir été créé");
});

test("7. POST /menus avec lignes[].recetteId inexistant : 400, aucune écriture", async () => {
  const { status } = await poster("/api/menus", {
    nom: "ERREURS FK TEST Menu Ligne",
    societeId,
    lignes: [{ recetteId: ID_INEXISTANT, quantite: 1 }],
  });
  assert.equal(status, 400);
  const cree = await prisma.menu.findFirst({ where: { nom: "ERREURS FK TEST Menu Ligne" } });
  assert.equal(cree, null, "aucun menu ne doit avoir été créé");
});

test("8. PUT /menus/:id avec categorieId inexistant : 400, valeur d'origine conservée", async () => {
  const base = await prisma.menu.create({ data: { nom: "ERREURS FK TEST Menu Base", societeId } });
  idsMenu.push(base.id);

  const { status } = await mettreAJour(`/api/menus/${base.id}`, {
    nom: "ERREURS FK TEST Menu Base Renomme",
    categorieId: ID_INEXISTANT,
    lignes: [],
  });
  assert.equal(status, 400);

  const enBase = await prisma.menu.findUniqueOrThrow({ where: { id: base.id } });
  assert.equal(enBase.nom, "ERREURS FK TEST Menu Base");
  assert.equal(enBase.categorieId, null);
});

// Depuis le chantier isolation société : un articleId ne correspondant à aucun article de la
// société connectée (qu'il soit inexistant ou appartienne à une autre société) est filtré AVANT
// d'atteindre Prisma (voir server/routes/aliasIngredients.ts) — jamais de violation FK, la requête
// réussit (204) mais n'écrit silencieusement rien, même principe permissif que pour un articleId
// désactivé entretemps.
test("9. POST /alias-ingredients avec articleId inexistant : 204, aucune écriture", async () => {
  const texteTest = "ERREURS FK TEST ingredient texte unique zzz";
  const { status } = await poster("/api/alias-ingredients", {
    correspondances: [{ texte: texteTest, articleId: ID_INEXISTANT }],
  });
  assert.equal(status, 204);
  const cree = await prisma.aliasIngredientImport.findUnique({ where: { texteNormalise: normaliserTexte(texteTest) } });
  assert.equal(cree, null, "aucune correspondance ne doit avoir été créée");
});

test("10. POST /articles avec categorieId inexistant : 400, aucune écriture (non-régression du comportement PR #80/#81)", async () => {
  const { status } = await poster("/api/articles", {
    nom: "ERREURS FK TEST Article Cat",
    categorieId: ID_INEXISTANT,
    tvaId,
    societeId,
    rendement: 100,
    type: "MATIERE_PREMIERE",
  });
  assert.equal(status, 400);
  const cree = await prisma.article.findFirst({ where: { nom: "ERREURS FK TEST Article Cat" } });
  assert.equal(cree, null, "aucun article ne doit avoir été créé");
});

test("11. PUT /articles/:id avec categorieId inexistant : 400, article d'origine conservé", async () => {
  const { status } = await mettreAJour(`/api/articles/${articleId}`, {
    nom: "ERREURS FK TEST Article Renomme",
    categorieId: ID_INEXISTANT,
    rendement: 100,
  });
  assert.equal(status, 400);

  const enBase = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  assert.equal(enBase.nom, "ERREURS FK TEST Article");
});

test("12. POST /recettes avec categorieId inexistant : 400, aucune écriture", async () => {
  const { status } = await poster("/api/recettes", {
    nom: "ERREURS FK TEST Recette Cat",
    societeId,
    categorieId: ID_INEXISTANT,
    portions: 2,
    lignes: [],
  });
  assert.equal(status, 400);
  const cree = await prisma.recette.findFirst({ where: { nom: "ERREURS FK TEST Recette Cat" } });
  assert.equal(cree, null, "aucune recette ne doit avoir été créée");
});

test("13. PUT /recettes/:id avec sousCategorieId inexistant : 400, recette d'origine conservée", async () => {
  const { status } = await mettreAJour(`/api/recettes/${recetteExistanteId}`, {
    nom: "ERREURS FK TEST Recette Base Renomme",
    sousCategorieId: ID_INEXISTANT,
    portions: 2,
    lignes: [],
  });
  assert.equal(status, 400);

  const enBase = await prisma.recette.findUniqueOrThrow({ where: { id: recetteExistanteId } });
  assert.equal(enBase.nom, "ERREURS FK TEST Recette Base");
});

test("14. Non-régression : POST /recettes avec portions=0 reste en 500 (erreur métier, pas une FK)", async () => {
  const { status } = await poster("/api/recettes", {
    nom: "ERREURS FK TEST Recette Portions Zero",
    societeId,
    portions: 0,
    lignes: [],
  });
  assert.equal(status, 500, "comportement déjà correct et volontairement inchangé (voir coutRecette.ts)");
  const cree = await prisma.recette.findFirst({ where: { nom: "ERREURS FK TEST Recette Portions Zero" } });
  assert.equal(cree, null, "aucune recette ne doit avoir été créée");
});

test("15. Non-régression : POST /articles avec un article valide fonctionne normalement", async () => {
  const { status, corps } = await poster("/api/articles", {
    nom: "ERREURS FK TEST Article NonRegression",
    categorieId,
    tvaId,
    societeId,
    rendement: 100,
    type: "MATIERE_PREMIERE",
  });
  assert.equal(status, 201);
  await prisma.article.delete({ where: { id: corps.id } });
});
