import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

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

test("1. POST /depots avec societeId inexistant : 400, aucune écriture", async () => {
  const avant = await prisma.depot.count();
  const { status } = await poster("/api/depots", { nom: "ERREURS FK TEST Depot", societeId: ID_INEXISTANT });
  assert.equal(status, 400);
  const apres = await prisma.depot.count();
  assert.equal(apres, avant, "aucun dépôt ne doit avoir été créé");
});

test("2. POST /fournisseurs avec societeId inexistant : 400, aucune écriture", async () => {
  const avant = await prisma.fournisseur.count();
  const { status } = await poster("/api/fournisseurs", { nom: "ERREURS FK TEST Fournisseur", societeId: ID_INEXISTANT });
  assert.equal(status, 400);
  const apres = await prisma.fournisseur.count();
  assert.equal(apres, avant, "aucun fournisseur ne doit avoir été créé");
});

test("3. POST /sous-categories-recette avec parentId inexistant : 400, aucune écriture", async () => {
  const avant = await prisma.sousCategorieRecette.count();
  const { status } = await poster("/api/sous-categories-recette", { nom: "ERREURS FK TEST SousCategorie", parentId: ID_INEXISTANT });
  assert.equal(status, 400);
  const apres = await prisma.sousCategorieRecette.count();
  assert.equal(apres, avant, "aucune sous-catégorie ne doit avoir été créée");
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

test("5. POST /menus avec societeId inexistant : 400, aucune écriture", async () => {
  const avant = await prisma.menu.count();
  const { status } = await poster("/api/menus", { nom: "ERREURS FK TEST Menu Societe", societeId: ID_INEXISTANT, lignes: [] });
  assert.equal(status, 400);
  const apres = await prisma.menu.count();
  assert.equal(apres, avant, "aucun menu ne doit avoir été créé");
});

test("6. POST /menus avec categorieId inexistant : 400, aucune écriture", async () => {
  const avant = await prisma.menu.count();
  const { status } = await poster("/api/menus", { nom: "ERREURS FK TEST Menu Categorie", societeId, categorieId: ID_INEXISTANT, lignes: [] });
  assert.equal(status, 400);
  const apres = await prisma.menu.count();
  assert.equal(apres, avant, "aucun menu ne doit avoir été créé");
});

test("7. POST /menus avec lignes[].recetteId inexistant : 400, aucune écriture", async () => {
  const avant = await prisma.menu.count();
  const { status } = await poster("/api/menus", {
    nom: "ERREURS FK TEST Menu Ligne",
    societeId,
    lignes: [{ recetteId: ID_INEXISTANT, quantite: 1 }],
  });
  assert.equal(status, 400);
  const apres = await prisma.menu.count();
  assert.equal(apres, avant, "aucun menu ne doit avoir été créé");
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

test("9. POST /alias-ingredients avec articleId inexistant : 400, aucune écriture", async () => {
  const avant = await prisma.aliasIngredientImport.count();
  const { status } = await poster("/api/alias-ingredients", {
    correspondances: [{ texte: "ERREURS FK TEST ingredient texte unique zzz", articleId: ID_INEXISTANT }],
  });
  assert.equal(status, 400);
  const apres = await prisma.aliasIngredientImport.count();
  assert.equal(apres, avant, "aucune correspondance ne doit avoir été créée");
});

test("10. POST /articles avec categorieId inexistant : 400, aucune écriture (non-régression du comportement PR #80/#81)", async () => {
  const avant = await prisma.article.count();
  const { status } = await poster("/api/articles", {
    nom: "ERREURS FK TEST Article Cat",
    categorieId: ID_INEXISTANT,
    tvaId,
    societeId,
    rendement: 100,
    type: "MATIERE_PREMIERE",
  });
  assert.equal(status, 400);
  const apres = await prisma.article.count();
  assert.equal(apres, avant, "aucun article ne doit avoir été créé");
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
  const avant = await prisma.recette.count();
  const { status } = await poster("/api/recettes", {
    nom: "ERREURS FK TEST Recette Cat",
    societeId,
    categorieId: ID_INEXISTANT,
    portions: 2,
    lignes: [],
  });
  assert.equal(status, 400);
  const apres = await prisma.recette.count();
  assert.equal(apres, avant, "aucune recette ne doit avoir été créée");
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
  const avant = await prisma.recette.count();
  const { status } = await poster("/api/recettes", {
    nom: "ERREURS FK TEST Recette Portions Zero",
    societeId,
    portions: 0,
    lignes: [],
  });
  assert.equal(status, 500, "comportement déjà correct et volontairement inchangé (voir coutRecette.ts)");
  const apres = await prisma.recette.count();
  assert.equal(apres, avant, "aucune recette ne doit avoir été créée");
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
