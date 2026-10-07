import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest, creerUtilisateurAutreSocieteDeTest } from "../helpers/auth.js";

// Faille confirmée (audit F09/F10, 2026-10-07) : POST/PUT /api/menus validaient bien categorieId
// contre societeId, mais utilisaient directement les recetteId de `lignes` sans jamais vérifier
// qu'ils appartiennent à la société connectée — un recetteId d'une autre société passait la
// contrainte de clé étrangère (Recette.id est un espace global, pas composite avec societeId) et le
// menu était créé/modifié avec succès, exposant ensuite nom/coût/allergènes/nutrition de la recette
// étrangère via GET /api/menus/:id (inclusionsMenu). Ce fichier démontre que le correctif
// (recettesAppartiennentALaSociete, server/routes/menus.ts) bloque bien les trois cas (POST,
// mélange, PUT), sans jamais distinguer "recette inexistante" de "recette d'une autre société", et
// sans jamais laisser un menu existant partiellement modifié.

const PREFIXE = "ISOLATION MENUS TEST";

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

async function obtenir(jeton: string, chemin: string) {
  const reponse = await fetch(`${baseUrl}${chemin}`, { headers: authHeaders(jeton) });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
}

async function creerRecette(jeton: string, nom: string): Promise<number> {
  const creation = await poster(jeton, "/api/recettes", { nom });
  assert.equal(creation.status, 201, `précondition de test : création de la recette "${nom}" doit réussir`);
  return creation.corps.id;
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
  await prisma.menu.deleteMany({ where: { nom: { startsWith: PREFIXE } } });
  await prisma.recette.deleteMany({ where: { nom: { startsWith: PREFIXE } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("A. POST /api/menus : une recette de la société connectée est acceptée normalement", async () => {
  const recetteA = await creerRecette(token, `${PREFIXE} Recette A1`);

  const creation = await poster(token, "/api/menus", {
    nom: `${PREFIXE} Menu A valide`,
    lignes: [{ recetteId: recetteA, quantite: 2 }],
  });

  assert.equal(creation.status, 201);
  assert.equal(creation.corps.lignes.length, 1);
  assert.equal(creation.corps.lignes[0].recette.id, recetteA);
});

test("B. POST /api/menus : un recetteId appartenant à une AUTRE société est refusé, sans exposer de donnée de cette société", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const nomRecetteB = `${PREFIXE} Recette B secrète`;
  const recetteB = await creerRecette(autreSociete.token, nomRecetteB);

  const tentative = await poster(token, "/api/menus", {
    nom: `${PREFIXE} Menu refuse B`,
    lignes: [{ recetteId: recetteB, quantite: 1 }],
  });

  assert.equal(tentative.status, 400);
  assert.equal(tentative.corps.error, "Une ou plusieurs recettes sont invalides");
  // Aucune information sur la recette B (nom, id, société) ne doit fuiter dans la réponse d'erreur.
  const corpsSerialise = JSON.stringify(tentative.corps);
  assert.ok(!corpsSerialise.includes(nomRecetteB), "le nom de la recette étrangère ne doit jamais apparaître dans la réponse");
  assert.ok(!corpsSerialise.includes(String(recetteB)), "l'id de la recette étrangère ne doit jamais apparaître dans la réponse");

  const creeMalgreTout = await prisma.menu.findFirst({ where: { nom: `${PREFIXE} Menu refuse B` } });
  assert.equal(creeMalgreTout, null, "aucun menu ne doit avoir été créé");
});

test("C. POST /api/menus : un mélange recette valide + recette étrangère refuse la création dans son ensemble", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const recetteA = await creerRecette(token, `${PREFIXE} Recette A2`);
  const recetteB = await creerRecette(autreSociete.token, `${PREFIXE} Recette B mélange`);

  const tentative = await poster(token, "/api/menus", {
    nom: `${PREFIXE} Menu melange refuse`,
    lignes: [
      { recetteId: recetteA, quantite: 1 },
      { recetteId: recetteB, quantite: 1 },
    ],
  });

  assert.equal(tentative.status, 400);
  assert.equal(tentative.corps.error, "Une ou plusieurs recettes sont invalides");

  const creeMalgreTout = await prisma.menu.findFirst({ where: { nom: `${PREFIXE} Menu melange refuse` } });
  assert.equal(creeMalgreTout, null, "aucun menu ne doit avoir été créé, même partiellement");
});

test("D. PUT /api/menus/:id : remplacement par une recette de la société connectée réussit normalement", async () => {
  const recetteA1 = await creerRecette(token, `${PREFIXE} Recette A3 initiale`);
  const recetteA2 = await creerRecette(token, `${PREFIXE} Recette A3 remplacement`);

  const creation = await poster(token, "/api/menus", {
    nom: `${PREFIXE} Menu D`,
    lignes: [{ recetteId: recetteA1, quantite: 1 }],
  });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;

  const miseAJour = await mettreAJour(token, `/api/menus/${menuId}`, {
    nom: `${PREFIXE} Menu D`,
    lignes: [{ recetteId: recetteA2, quantite: 3 }],
  });

  assert.equal(miseAJour.status, 200);
  assert.equal(miseAJour.corps.lignes.length, 1);
  assert.equal(miseAJour.corps.lignes[0].recette.id, recetteA2);
});

test("E. PUT /api/menus/:id : une tentative de remplacement par une recette étrangère laisse le menu existant strictement inchangé", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const recetteA = await creerRecette(token, `${PREFIXE} Recette A4 originale`);
  const recetteB = await creerRecette(autreSociete.token, `${PREFIXE} Recette B4 etrangere`);

  const creation = await poster(token, "/api/menus", {
    nom: `${PREFIXE} Menu E original`,
    description: "description originale",
    prixVenteHT: 12.5,
    lignes: [{ recetteId: recetteA, quantite: 2 }],
  });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;

  const tentative = await mettreAJour(token, `/api/menus/${menuId}`, {
    nom: `${PREFIXE} Menu E PIRATE`,
    description: "description piratee",
    prixVenteHT: 999,
    lignes: [{ recetteId: recetteB, quantite: 1 }],
  });

  assert.equal(tentative.status, 400);
  assert.equal(tentative.corps.error, "Une ou plusieurs recettes sont invalides");

  // Le menu en base n'a strictement pas bougé : ni les champs du menu, ni ses lignes d'origine.
  const enBase = await prisma.menu.findUniqueOrThrow({
    where: { id: menuId },
    include: { lignes: true },
  });
  assert.equal(enBase.nom, `${PREFIXE} Menu E original`, "le nom ne doit jamais avoir été modifié");
  assert.equal(enBase.description, "description originale", "la description ne doit jamais avoir été modifiée");
  assert.equal(enBase.prixVenteHT, 12.5, "le prix ne doit jamais avoir été modifié");
  assert.equal(enBase.lignes.length, 1, "les anciennes lignes doivent toujours être présentes");
  assert.equal(enBase.lignes[0].recetteId, recetteA, "l'ancienne ligne doit toujours pointer vers la recette A");
  assert.ok(
    !enBase.lignes.some((l) => l.recetteId === recetteB),
    "aucune nouvelle ligne pointant vers la recette étrangère ne doit avoir été créée"
  );
});

test("F. GET /api/menus/:id après une tentative interdite ne renvoie aucune donnée de la société étrangère", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const recetteA = await creerRecette(token, `${PREFIXE} Recette A5`);
  const nomRecetteB = `${PREFIXE} Recette B5 jamais visible`;
  const recetteB = await creerRecette(autreSociete.token, nomRecetteB);

  const creation = await poster(token, "/api/menus", {
    nom: `${PREFIXE} Menu F`,
    lignes: [{ recetteId: recetteA, quantite: 1 }],
  });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;

  const tentative = await mettreAJour(token, `/api/menus/${menuId}`, {
    nom: `${PREFIXE} Menu F`,
    lignes: [{ recetteId: recetteB, quantite: 1 }],
  });
  assert.equal(tentative.status, 400);

  const lecture = await obtenir(token, `/api/menus/${menuId}`);
  assert.equal(lecture.status, 200);
  // Vérification structurelle (jamais une recherche de sous-chaîne sur un id numérique brut dans
  // tout le JSON : un petit entier comme celui d'une recette peut coïncider par hasard avec
  // n'importe quel autre nombre du payload — coût, quantité, id d'un autre enregistrement — une
  // fois la base de test chargée de milliers de lignes, comme en CI).
  assert.ok(
    !JSON.stringify(lecture.corps).includes(nomRecetteB),
    "le nom de la recette B ne doit jamais apparaître dans la lecture du menu"
  );
  assert.equal(lecture.corps.lignes.length, 1, "le menu ne doit contenir que sa ligne d'origine");
  assert.equal(lecture.corps.lignes[0].recette.id, recetteA, "la seule ligne du menu doit toujours pointer vers la recette A");
  assert.ok(
    !lecture.corps.lignes.some((ligne: { recette: { id: number } }) => ligne.recette.id === recetteB),
    "aucune ligne ne doit pointer vers la recette B"
  );
});

test("G. recetteId inexistant : même réponse générique que recetteId d'une autre société, aucune distinction possible", async () => {
  const idInexistant = 999_999_999;

  const tentative = await poster(token, "/api/menus", {
    nom: `${PREFIXE} Menu G inexistant`,
    lignes: [{ recetteId: idInexistant, quantite: 1 }],
  });

  assert.equal(tentative.status, 400);
  assert.equal(
    tentative.corps.error,
    "Une ou plusieurs recettes sont invalides",
    "même message que pour une recette d'une autre société — jamais de distinction exposée"
  );

  const creeMalgreTout = await prisma.menu.findFirst({ where: { nom: `${PREFIXE} Menu G inexistant` } });
  assert.equal(creeMalgreTout, null);
});
