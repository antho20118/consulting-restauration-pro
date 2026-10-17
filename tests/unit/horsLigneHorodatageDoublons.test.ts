import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Point 9 de l'audit du 15/10 — saisies faites hors connexion (file d'attente du téléphone,
// src/offline/), rejouées au retour du réseau :
// 1. une production ou un contrôle HACCP recevait l'heure de la SYNCHRONISATION, pas celle de la
//    saisie réelle (traçabilité HACCP fausse) ;
// 2. une saisie dont la réponse s'était perdue (réseau coupé après l'envoi) était renvoyée et
//    enregistrée deux fois — pour une production, le stock était déduit deux fois.
// L'heure déclarée par l'appareil est désormais retenue, bornée (jamais dans le futur, jamais plus
// de 7 jours en arrière) ; l'heure de réception par le serveur reste enregistrée (createdAt) et
// chaque saisie porte une clé unique qui rend son renvoi sans effet.

let server: Server;
let baseUrl: string;
let societeId: number;
let jeton: string;
let jetonAutreSociete: string;
let autreSocieteId: number;
let recetteAutreId: number;
let articleId: number;
let depotId: number;
let recetteId: number;
let etapeId: number;
const marqueur = `HORS-LIGNE-${randomUUID()}`;

async function connecter(identifiant: string): Promise<string> {
  const reponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  return ((await reponse.json()) as { token: string }).token;
}

function appel(jetonUtilise: string, method: string, chemin: string, body?: unknown) {
  return fetch(`${baseUrl}/api${chemin}`, {
    method,
    headers: { Authorization: `Bearer ${jetonUtilise}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const stockRestant = async () => (await prisma.stock.findFirstOrThrow({ where: { articleId, depotId } })).quantite;
const ilYa = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const ecartSecondes = (a: Date | string, b: Date) => Math.abs(new Date(a).getTime() - b.getTime()) / 1000;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  societeId = (await prisma.societe.create({ data: { nom: marqueur } })).id;
  autreSocieteId = (await prisma.societe.create({ data: { nom: `${marqueur} autre` } })).id;
  await prisma.utilisateur.create({ data: { identifiant: `${marqueur}-cuisinier`, codeHache: hacherCode("1234"), role: "CUISINIER", societeId } });
  await prisma.utilisateur.create({
    data: { identifiant: `${marqueur}-autre`, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId: autreSocieteId },
  });
  jeton = await connecter(`${marqueur}-cuisinier`);
  jetonAutreSociete = await connecter(`${marqueur}-autre`);

  const categorieId = (await prisma.categorie.create({ data: { nom: marqueur, societeId } })).id;
  const tvaId = (await prisma.tVA.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
  const kgId = (
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }))
  ).id;
  articleId = (await prisma.article.create({ data: { nom: `${marqueur} riz`, type: "MATIERE_PREMIERE", categorieId, tvaId, societeId } })).id;
  depotId = (await prisma.depot.create({ data: { nom: marqueur, societeId } })).id;
  await prisma.stock.create({ data: { articleId, depotId, quantite: 10_000 } });
  const recette = await prisma.recette.create({
    data: {
      nom: `${marqueur} riz cuit`,
      societeId,
      portions: 1,
      lignes: { create: [{ articleId, quantite: 1, uniteId: kgId }] },
      etapes: { create: [{ ordre: 1, description: "Cuire à cœur", pointCritiqueHACCP: true, controleHACCP: "≥ 63 °C" }] },
    },
    include: { etapes: true },
  });
  recetteId = recette.id;
  etapeId = recette.etapes[0].id;
  // Recette (sans ingrédient) propre à l'autre société : sa production serait acceptée, seule la
  // clé déjà utilisée par la première société doit la faire refuser.
  recetteAutreId = (await prisma.recette.create({ data: { nom: `${marqueur} autre`, societeId: autreSocieteId, portions: 1 } })).id;
});

after(async () => {
  try {
    await prisma.controleHACCPProduction.deleteMany({ where: { production: { societeId } } });
    await prisma.mouvementStock.deleteMany({ where: { depotId } });
    await prisma.production.deleteMany({ where: { societeId } });
    await prisma.stock.deleteMany({ where: { depotId } });
    await prisma.recetteEtape.deleteMany({ where: { recetteId } });
    await prisma.recetteLigne.deleteMany({ where: { recetteId } });
    await prisma.production.deleteMany({ where: { societeId: autreSocieteId } });
    await prisma.recette.deleteMany({ where: { societeId: { in: [societeId, autreSocieteId] } } });
    await prisma.article.deleteMany({ where: { societeId } });
    await prisma.depot.deleteMany({ where: { societeId } });
    await prisma.categorie.deleteMany({ where: { societeId } });
    await prisma.utilisateur.deleteMany({ where: { societeId: { in: [societeId, autreSocieteId] } } });
    await prisma.societe.deleteMany({ where: { id: { in: [societeId, autreSocieteId] } } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

test("production saisie hors connexion : datée de la saisie, l'heure de réception restant enregistrée", async () => {
  const saisie = ilYa(120);
  const reponse = await appel(jeton, "POST", "/productions", {
    recetteId,
    depotId,
    cible: { mode: "portions", valeur: 1 },
    cleIdempotence: randomUUID(),
    realiseeLe: saisie.toISOString(),
  });
  assert.equal(reponse.status, 201, await reponse.clone().text());
  const production = (await reponse.json()) as { id: number; dateProduction: string; createdAt: string };
  assert.ok(ecartSecondes(production.dateProduction, saisie) < 1, `dateProduction ${production.dateProduction}`);
  assert.ok(ecartSecondes(production.createdAt, new Date()) < 60);
});

test("production renvoyée avec la même clé (réponse perdue) : une seule production, stock déduit une seule fois", async () => {
  const cle = randomUUID();
  const corps = { recetteId, depotId, cible: { mode: "portions", valeur: 1 }, cleIdempotence: cle, realiseeLe: ilYa(30).toISOString() };
  const stockAvant = await stockRestant();
  const premiere = await appel(jeton, "POST", "/productions", corps);
  assert.equal(premiere.status, 201);
  const renvoi = await appel(jeton, "POST", "/productions", corps);
  assert.ok(renvoi.status === 200 || renvoi.status === 201, `renvoi : ${renvoi.status}`);
  assert.equal(((await renvoi.json()) as { id: number }).id, ((await premiere.json()) as { id: number }).id);
  assert.equal(await prisma.production.count({ where: { societeId, cleIdempotence: cle } }), 1);
  assert.equal(await stockRestant(), stockAvant - 1000);
});

test("contrôle HACCP saisi hors connexion : daté de la saisie ; renvoyé avec la même clé : enregistré une seule fois", async () => {
  const productionId = (
    (await (await appel(jeton, "POST", "/productions", { recetteId, cible: { mode: "portions", valeur: 1 } })).json()) as { id: number }
  ).id;
  const saisie = ilYa(45);
  const cle = randomUUID();
  const corps = { recetteEtapeId: etapeId, valeur: "71 °C", conforme: true, cleIdempotence: cle, constateLe: saisie.toISOString() };
  const premiere = await appel(jeton, "POST", `/productions/${productionId}/controles`, corps);
  assert.equal(premiere.status, 201, await premiere.clone().text());
  const renvoi = await appel(jeton, "POST", `/productions/${productionId}/controles`, corps);
  assert.ok(renvoi.status === 200 || renvoi.status === 201, `renvoi : ${renvoi.status}`);

  const controles = await prisma.controleHACCPProduction.findMany({ where: { productionId } });
  assert.equal(controles.length, 1);
  assert.ok(ecartSecondes(controles[0].dateHeure, saisie) < 1, `dateHeure ${controles[0].dateHeure.toISOString()}`);
  assert.ok(ecartSecondes(controles[0].createdAt, new Date()) < 60);
});

test("heure déclarée bornée : dans le futur -> heure du serveur ; plus de 7 jours en arrière -> refusé, rien enregistré", async () => {
  const productionId = (
    (await (await appel(jeton, "POST", "/productions", { recetteId, cible: { mode: "portions", valeur: 1 } })).json()) as { id: number }
  ).id;
  const futur = await appel(jeton, "POST", `/productions/${productionId}/controles`, {
    recetteEtapeId: etapeId,
    valeur: "70 °C",
    conforme: true,
    constateLe: new Date(Date.now() + 24 * 3600_000).toISOString(),
  });
  assert.equal(futur.status, 201);
  const [controle] = await prisma.controleHACCPProduction.findMany({ where: { productionId } });
  assert.ok(ecartSecondes(controle.dateHeure, new Date()) < 60, "un appareil à l'heure fausse (en avance) ne date jamais un contrôle dans le futur");

  const tropAncien = await appel(jeton, "POST", `/productions/${productionId}/controles`, {
    recetteEtapeId: etapeId,
    valeur: "70 °C",
    conforme: true,
    constateLe: new Date(Date.now() - 8 * 24 * 3600_000).toISOString(),
  });
  assert.equal(tropAncien.status, 400);
  assert.equal(await prisma.controleHACCPProduction.count({ where: { productionId } }), 1);
});

test("en ligne, sans heure déclarée : heure du serveur, comme avant", async () => {
  const reponse = await appel(jeton, "POST", "/productions", { recetteId, cible: { mode: "portions", valeur: 1 } });
  const production = (await reponse.json()) as { dateProduction: string };
  assert.ok(ecartSecondes(production.dateProduction, new Date()) < 60);
});

test("clé déjà utilisée par une autre société : refusée (409), sans rien révéler ni créer", async () => {
  const cle = randomUUID();
  await appel(jeton, "POST", "/productions", { recetteId, cible: { mode: "portions", valeur: 1 }, cleIdempotence: cle });
  const sansCle = await appel(jetonAutreSociete, "POST", "/productions", { recetteId: recetteAutreId, cible: { mode: "portions", valeur: 1 } });
  assert.equal(sansCle.status, 201, "témoin : sans la clé, l'autre société peut produire sa recette");
  await prisma.production.deleteMany({ where: { societeId: autreSocieteId } });
  const autre = await appel(jetonAutreSociete, "POST", "/productions", { recetteId: recetteAutreId, cible: { mode: "portions", valeur: 1 }, cleIdempotence: cle });
  assert.equal(autre.status, 409);
  assert.doesNotMatch(await autre.text(), new RegExp(marqueur));
  assert.equal(await prisma.production.count({ where: { societeId: autreSocieteId } }), 0);
});
