import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest, creerUtilisateurAutreSocieteDeTest } from "../helpers/auth.js";

// F11 de l'audit forensique : Categorie, CategorieRecette et SousCategorieRecette sont désormais
// cloisonnées par société (voir prisma/schema.prisma et server/routes/{categories,categoriesRecette,
// sousCategoriesRecette}.ts) — contrairement à TVA/Unite, qui restent volontairement partagés. Ce
// fichier démontre, pour chacun des trois modèles, que l'isolation tient réellement : une société B
// ne peut ni lire (liste), ni modifier, ni supprimer une ligne créée par une société A, et le même
// nom peut coexister dans les deux sociétés grâce à la nouvelle contrainte unique composite
// (societeId, nom). Même méthode que les tests d'isolation F07 existants (voir
// tests/helpers/auth.ts, creerUtilisateurAutreSocieteDeTest) : une VRAIE autre société avec son
// propre compte, jamais un simple societeId falsifié dans le corps d'une requête.

const PREFIXE = "ISOLATION F11 TEST";

let server: Server;
let baseUrl: string;
let token: string;

function authHeaders(jeton: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` };
}

async function poster(jeton: string, chemin: string, corpsPayload: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}${chemin}`, {
    method: "POST",
    headers: authHeaders(jeton),
    body: JSON.stringify(corpsPayload),
  });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
}

async function mettreAJour(jeton: string, chemin: string, corpsPayload: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}${chemin}`, {
    method: "PUT",
    headers: authHeaders(jeton),
    body: JSON.stringify(corpsPayload),
  });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
}

async function supprimer(jeton: string, chemin: string) {
  const reponse = await fetch(`${baseUrl}${chemin}`, { method: "DELETE", headers: authHeaders(jeton) });
  return { status: reponse.status };
}

async function lister(jeton: string, chemin: string): Promise<{ id: number; nom: string }[]> {
  const reponse = await fetch(`${baseUrl}${chemin}`, { headers: authHeaders(jeton) });
  return reponse.json();
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
});

after(async () => {
  await prisma.categorie.deleteMany({ where: { nom: { startsWith: PREFIXE } } });
  await prisma.categorieRecette.deleteMany({ where: { nom: { startsWith: PREFIXE } } });
  await prisma.sousCategorieRecette.deleteMany({ where: { nom: { startsWith: PREFIXE } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("Categorie : isolation complète entre deux sociétés (création, lecture, modification, suppression, coexistence du nom)", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const nom = `${PREFIXE} Categorie Partagée`;

  // Création par la société A.
  const creation = await poster(token, "/api/categories", { nom });
  assert.equal(creation.status, 201);
  const idA = creation.corps.id;

  // Lecture : la société B ne voit jamais la catégorie de A dans sa propre liste.
  const listeB = await lister(autreSociete.token, "/api/categories");
  assert.ok(!listeB.some((c) => c.id === idA), "la catégorie de la société A ne doit jamais apparaître dans la liste de la société B");

  // Modification : la société B ne peut pas renommer la catégorie de A (404, jamais 500).
  const miseAJour = await mettreAJour(autreSociete.token, `/api/categories/${idA}`, { nom: "PIRATE" });
  assert.equal(miseAJour.status, 404, "jamais 500 : l'id existe réellement, juste dans une autre société");

  // Suppression : la société B ne peut pas supprimer la catégorie de A.
  const suppression = await supprimer(autreSociete.token, `/api/categories/${idA}`);
  assert.equal(suppression.status, 404);

  // La catégorie de A n'a été ni renommée ni supprimée par les tentatives de B.
  const enBase = await prisma.categorie.findUniqueOrThrow({ where: { id: idA } });
  assert.equal(enBase.nom, nom, "jamais modifiée par le compte d'une autre société");

  // Coexistence : la société B peut créer une catégorie du même nom exact, sans collision
  // d'unicité (la contrainte est désormais composite (societeId, nom), plus globale sur nom seul).
  const creationB = await poster(autreSociete.token, "/api/categories", { nom });
  assert.equal(creationB.status, 201, "le même nom doit pouvoir coexister dans deux sociétés différentes");
  assert.notEqual(creationB.corps.id, idA);
  assert.equal(creationB.corps.societeId, autreSociete.societeId);
});

test("CategorieRecette : isolation complète entre deux sociétés (création, lecture, modification, suppression, coexistence du nom)", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const nom = `${PREFIXE} CategorieRecette Partagée`;

  const creation = await poster(token, "/api/categories-recette", { nom });
  assert.equal(creation.status, 201);
  const idA = creation.corps.id;

  const listeB = await lister(autreSociete.token, "/api/categories-recette");
  assert.ok(!listeB.some((c) => c.id === idA), "la catégorie de recette de la société A ne doit jamais apparaître dans la liste de la société B");

  const miseAJour = await mettreAJour(autreSociete.token, `/api/categories-recette/${idA}`, { nom: "PIRATE" });
  assert.equal(miseAJour.status, 404);

  const suppression = await supprimer(autreSociete.token, `/api/categories-recette/${idA}`);
  assert.equal(suppression.status, 404);

  const enBase = await prisma.categorieRecette.findUniqueOrThrow({ where: { id: idA } });
  assert.equal(enBase.nom, nom, "jamais modifiée par le compte d'une autre société");

  const creationB = await poster(autreSociete.token, "/api/categories-recette", { nom });
  assert.equal(creationB.status, 201, "le même nom doit pouvoir coexister dans deux sociétés différentes");
  assert.notEqual(creationB.corps.id, idA);
  assert.equal(creationB.corps.societeId, autreSociete.societeId);
});

test("SousCategorieRecette : isolation complète entre deux sociétés (création, lecture, modification, suppression, coexistence du nom)", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const nom = `${PREFIXE} SousCategorieRecette Partagée`;

  const creation = await poster(token, "/api/sous-categories-recette", { nom });
  assert.equal(creation.status, 201);
  const idA = creation.corps.id;

  const listeB = await lister(autreSociete.token, "/api/sous-categories-recette");
  assert.ok(!listeB.some((c) => c.id === idA), "la sous-catégorie de recette de la société A ne doit jamais apparaître dans la liste de la société B");

  const miseAJour = await mettreAJour(autreSociete.token, `/api/sous-categories-recette/${idA}`, { nom: "PIRATE" });
  assert.equal(miseAJour.status, 404);

  const suppression = await supprimer(autreSociete.token, `/api/sous-categories-recette/${idA}`);
  assert.equal(suppression.status, 404);

  const enBase = await prisma.sousCategorieRecette.findUniqueOrThrow({ where: { id: idA } });
  assert.equal(enBase.nom, nom, "jamais modifiée par le compte d'une autre société");

  const creationB = await poster(autreSociete.token, "/api/sous-categories-recette", { nom });
  assert.equal(creationB.status, 201, "le même nom doit pouvoir coexister dans deux sociétés différentes");
  assert.notEqual(creationB.corps.id, idA);
  assert.equal(creationB.corps.societeId, autreSociete.societeId);
});

// Couture spécifique à SousCategorieRecette (relation parentId auto-référencée) : sans ce contrôle,
// une société B pourrait rattacher sa propre sous-catégorie à une sous-catégorie de A simplement en
// devinant/énumérant son id, contournant ainsi le cloisonnement malgré les gardes ci-dessus.
test("SousCategorieRecette : une société B ne peut pas utiliser comme parentId une sous-catégorie appartenant à A", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);

  const parentA = await poster(token, "/api/sous-categories-recette", { nom: `${PREFIXE} Parent A` });
  assert.equal(parentA.status, 201);
  const idParentA = parentA.corps.id;

  // POST avec parentId appartenant à A : refusé (400), aucune écriture.
  const creationRefusee = await poster(autreSociete.token, "/api/sous-categories-recette", {
    nom: `${PREFIXE} Enfant chez B`,
    parentId: idParentA,
  });
  assert.equal(creationRefusee.status, 400);
  const creeMalgreTout = await prisma.sousCategorieRecette.findFirst({
    where: { nom: `${PREFIXE} Enfant chez B` },
  });
  assert.equal(creeMalgreTout, null, "aucune sous-catégorie ne doit avoir été créée chez B");

  // PUT avec parentId appartenant à A sur une sous-catégorie existante de B : refusé (400),
  // valeur d'origine conservée.
  const enfantB = await poster(autreSociete.token, "/api/sous-categories-recette", {
    nom: `${PREFIXE} Enfant B Base`,
  });
  assert.equal(enfantB.status, 201);

  const miseAJourRefusee = await mettreAJour(autreSociete.token, `/api/sous-categories-recette/${enfantB.corps.id}`, {
    nom: `${PREFIXE} Enfant B Renommé`,
    parentId: idParentA,
  });
  assert.equal(miseAJourRefusee.status, 400);

  const enBase = await prisma.sousCategorieRecette.findUniqueOrThrow({ where: { id: enfantB.corps.id } });
  assert.equal(enBase.nom, `${PREFIXE} Enfant B Base`, "jamais rattachée au parent de A");
  assert.equal(enBase.parentId, null);
});
