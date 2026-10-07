import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// PR C de l'audit F09/F10 : categories.ts et categoriesRecette.ts ne validaient pas `nom` (chaîne
// vide acceptée) et gèrent leurs erreurs manuellement (jamais via repondreErreurEcriture), donc un
// doublon (contrainte @@unique([societeId, nom]), voir prisma/schema.prisma) tombe en 500 générique
// au lieu du 409 que PR A a rendu disponible gratuitement aux routeurs qui utilisent déjà ce helper
// (sousCategoriesRecette.ts en bénéficie déjà, lui). sousCategoriesRecette.ts valide `parentId`
// contre la société mais n'empêche ni l'auto-référence (PUT parentId === id) ni une hiérarchie à
// plus d'un niveau — alors que le schéma (prisma/schema.prisma:160-163) et l'UI
// (SousCategoriesRecetteManager.tsx:70-74) documentent explicitement une hiérarchie à un seul
// niveau.
//
// Vrai serveur Express, vrai jeton (voir isolationReferentielsCategorie.test.ts pour le même
// principe sur ces 3 routeurs) : jamais de mock de req/res.

const PREFIXE = "VALIDATION PR C TEST";

let server: Server;
let baseUrl: string;
let token: string;

function authHeaders() {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
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
});

after(async () => {
  await prisma.categorie.deleteMany({ where: { nom: { startsWith: PREFIXE } } });
  await prisma.categorieRecette.deleteMany({ where: { nom: { startsWith: PREFIXE } } });
  await prisma.sousCategorieRecette.deleteMany({ where: { nom: { startsWith: PREFIXE } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

// --- nom vide : les 3 routeurs, POST et PUT (6 cas) ---

test("POST /api/categories : nom vide refusé en 400, jamais de création (aujourd'hui accepté à tort)", async () => {
  const { status } = await poster("/api/categories", { nom: "" });
  assert.equal(status, 400);
});

test("PUT /api/categories/:id : nom vide refusé en 400, aucune modification (aujourd'hui accepté à tort)", async () => {
  const creation = await poster("/api/categories", { nom: `${PREFIXE} Categorie PUT` });
  assert.equal(creation.status, 201);
  const { status } = await mettreAJour(`/api/categories/${creation.corps.id}`, { nom: "" });
  assert.equal(status, 400);
  const enBase = await prisma.categorie.findUniqueOrThrow({ where: { id: creation.corps.id } });
  assert.equal(enBase.nom, `${PREFIXE} Categorie PUT`);
});

test("POST /api/categories-recette : nom vide refusé en 400 (aujourd'hui accepté à tort)", async () => {
  const { status } = await poster("/api/categories-recette", { nom: "" });
  assert.equal(status, 400);
});

test("PUT /api/categories-recette/:id : nom vide refusé en 400, aucune modification (aujourd'hui accepté à tort)", async () => {
  const creation = await poster("/api/categories-recette", { nom: `${PREFIXE} CategorieRecette PUT` });
  assert.equal(creation.status, 201);
  const { status } = await mettreAJour(`/api/categories-recette/${creation.corps.id}`, { nom: "" });
  assert.equal(status, 400);
  const enBase = await prisma.categorieRecette.findUniqueOrThrow({ where: { id: creation.corps.id } });
  assert.equal(enBase.nom, `${PREFIXE} CategorieRecette PUT`);
});

test("POST /api/sous-categories-recette : nom vide refusé en 400 (aujourd'hui accepté à tort)", async () => {
  const { status } = await poster("/api/sous-categories-recette", { nom: "" });
  assert.equal(status, 400);
});

test("PUT /api/sous-categories-recette/:id : nom vide refusé en 400, aucune modification (aujourd'hui accepté à tort)", async () => {
  const creation = await poster("/api/sous-categories-recette", { nom: `${PREFIXE} SousCategorie PUT` });
  assert.equal(creation.status, 201);
  const { status } = await mettreAJour(`/api/sous-categories-recette/${creation.corps.id}`, { nom: "" });
  assert.equal(status, 400);
  const enBase = await prisma.sousCategorieRecette.findUniqueOrThrow({ where: { id: creation.corps.id } });
  assert.equal(enBase.nom, `${PREFIXE} SousCategorie PUT`);
});

// --- doublon → 409, pas 500 (contrainte @@unique([societeId, nom])) ---

test("POST /api/categories : un nom déjà utilisé dans la même société renvoie 409, pas 500 (aujourd'hui 500)", async () => {
  const nom = `${PREFIXE} Categorie Doublon ${randomUUID()}`;
  const premiere = await poster("/api/categories", { nom });
  assert.equal(premiere.status, 201);

  const doublon = await poster("/api/categories", { nom });
  assert.equal(doublon.status, 409);
  const texteBrut = JSON.stringify(doublon.corps);
  assert.ok(!texteBrut.includes("PrismaClientKnownRequestError"), "jamais le nom de la classe d'erreur Prisma");
  assert.ok(!texteBrut.includes("Unique constraint"), "jamais le message Prisma brut");
});

test("POST /api/categories-recette : un nom déjà utilisé dans la même société renvoie 409, pas 500 (aujourd'hui 500)", async () => {
  const nom = `${PREFIXE} CategorieRecette Doublon ${randomUUID()}`;
  const premiere = await poster("/api/categories-recette", { nom });
  assert.equal(premiere.status, 201);

  const doublon = await poster("/api/categories-recette", { nom });
  assert.equal(doublon.status, 409);
});

// --- sousCategoriesRecette : sécurisation de parentId ---

test("PUT /api/sous-categories-recette/:id : parentId === id (auto-référence) refusé en 400 (aujourd'hui accepté à tort)", async () => {
  const creation = await poster("/api/sous-categories-recette", { nom: `${PREFIXE} AutoRef` });
  assert.equal(creation.status, 201);
  const id = creation.corps.id;

  const { status } = await mettreAJour(`/api/sous-categories-recette/${id}`, {
    nom: `${PREFIXE} AutoRef`,
    parentId: id,
  });
  assert.equal(status, 400);

  const enBase = await prisma.sousCategorieRecette.findUniqueOrThrow({ where: { id } });
  assert.equal(enBase.parentId, null, "jamais devenir son propre parent");
});

// Modèle retenu : hiérarchie à un seul niveau (prisma/schema.prisma:160-163,
// SousCategoriesRecetteManager.tsx:70-74). Un parent qui a lui-même un parent ne doit jamais être
// accepté comme parent d'une autre sous-catégorie, ni en création ni en modification.
test("POST /api/sous-categories-recette : un parent qui a lui-même un parent (profondeur 2) est refusé en 400 (aujourd'hui accepté à tort)", async () => {
  const racine = await poster("/api/sous-categories-recette", { nom: `${PREFIXE} Racine Profondeur` });
  assert.equal(racine.status, 201);
  const enfant = await poster("/api/sous-categories-recette", {
    nom: `${PREFIXE} Enfant Profondeur`,
    parentId: racine.corps.id,
  });
  assert.equal(enfant.status, 201);

  // Tentative de créer un petit-enfant en utilisant l'enfant (qui a déjà un parent) comme parent.
  const petitEnfant = await poster("/api/sous-categories-recette", {
    nom: `${PREFIXE} PetitEnfant Profondeur`,
    parentId: enfant.corps.id,
  });
  assert.equal(petitEnfant.status, 400);

  const creeMalgreTout = await prisma.sousCategorieRecette.findFirst({
    where: { nom: `${PREFIXE} PetitEnfant Profondeur` },
  });
  assert.equal(creeMalgreTout, null, "aucune sous-catégorie à 3 niveaux ne doit être créée");
});

test("PUT /api/sous-categories-recette/:id : rattacher à un parent qui a lui-même un parent est refusé en 400 (aujourd'hui accepté à tort)", async () => {
  const racine = await poster("/api/sous-categories-recette", { nom: `${PREFIXE} Racine Profondeur PUT` });
  assert.equal(racine.status, 201);
  const enfant = await poster("/api/sous-categories-recette", {
    nom: `${PREFIXE} Enfant Profondeur PUT`,
    parentId: racine.corps.id,
  });
  assert.equal(enfant.status, 201);
  const autre = await poster("/api/sous-categories-recette", { nom: `${PREFIXE} Autre Racine PUT` });
  assert.equal(autre.status, 201);

  const { status } = await mettreAJour(`/api/sous-categories-recette/${autre.corps.id}`, {
    nom: `${PREFIXE} Autre Racine PUT`,
    parentId: enfant.corps.id,
  });
  assert.equal(status, 400);

  const enBase = await prisma.sousCategorieRecette.findUniqueOrThrow({ where: { id: autre.corps.id } });
  assert.equal(enBase.parentId, null, "ne doit jamais être rattachée à un parent qui a lui-même un parent");
});

// Tunnel sous la clôture : la garde "le parent choisi doit être une racine" ne suffit pas seule.
// A racine, B enfant de A, C racine : PUT A avec parentId=C passe cette garde (C est bien racine),
// mais produirait C → A → B, une profondeur de 2 — contraire au modèle à un seul niveau. Il faut
// aussi interdire de donner un parent à une sous-catégorie qui a elle-même déjà des enfants.
test("PUT /api/sous-categories-recette/:id : donner un parent à une sous-catégorie qui a déjà des enfants est refusé en 400 (aujourd'hui accepté à tort)", async () => {
  const a = await poster("/api/sous-categories-recette", { nom: `${PREFIXE} A Tunnel` });
  assert.equal(a.status, 201);
  const b = await poster("/api/sous-categories-recette", { nom: `${PREFIXE} B Tunnel`, parentId: a.corps.id });
  assert.equal(b.status, 201);
  const c = await poster("/api/sous-categories-recette", { nom: `${PREFIXE} C Tunnel` });
  assert.equal(c.status, 201);

  const { status } = await mettreAJour(`/api/sous-categories-recette/${a.corps.id}`, {
    nom: `${PREFIXE} A Tunnel`,
    parentId: c.corps.id,
  });
  assert.equal(status, 400);

  const aEnBase = await prisma.sousCategorieRecette.findUniqueOrThrow({ where: { id: a.corps.id } });
  assert.equal(aEnBase.parentId, null, "A ne doit jamais devenir enfant de C tant qu'il a lui-même un enfant (B)");
});

// Non-régression explicite : le parent inexistant renvoie déjà 400 aujourd'hui (voir
// erreursEcritureFK.test.ts, tests 3/4) — ce test confirme que ce comportement existant reste
// inchangé après l'introduction du schéma Zod sur `nom`/`parentId`.
test("POST /api/sous-categories-recette : parent inexistant refusé en 400 (comportement existant, non-régression)", async () => {
  const { status } = await poster("/api/sous-categories-recette", {
    nom: `${PREFIXE} Parent Inexistant`,
    parentId: 999999999,
  });
  assert.equal(status, 400);
});

// Non-régression explicite : isolationReferentielsCategorie.test.ts PUT categories/categoriesRecette
// avec { nom: "PIRATE" } seul (pas de parentId) doit continuer à fonctionner — le schéma Zod ne doit
// jamais exiger parentId comme clé obligatoire sur sousCategoriesRecette.
test("PUT /api/sous-categories-recette/:id : parentId omis (absent du corps) reste accepté, équivalent à null", async () => {
  const creation = await poster("/api/sous-categories-recette", { nom: `${PREFIXE} ParentIdOmis` });
  assert.equal(creation.status, 201);

  const { status, corps } = await mettreAJour(`/api/sous-categories-recette/${creation.corps.id}`, {
    nom: `${PREFIXE} ParentIdOmis Renomme`,
  });
  assert.equal(status, 200);
  assert.equal(corps.parentId, null);
});
