import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Test d'intégration réel (vrai serveur Express, vrai jeton) de GET /api/journal-erreurs et
// POST /api/journal-erreurs/client — voir tests/unit/sauvegardesRoute.test.ts pour le même principe.
//
// IMPORTANT sur l'ordre : le test du plafond par IP (POST .../client) doit rester le DERNIER test
// de ce fichier touchant cet endpoint — le compteur (journalErreursClient.ts, compteurParIp) est un
// état en mémoire partagé par tous les appels de ce fichier sur 127.0.0.1, jamais remis à zéro entre
// les tests (même principe que tests/unit/auth.test.ts).

let server: Server;
let baseUrl: string;
let societeId: number;
let token: string;
const idsUtilisateur: number[] = [];
const idsJournal: number[] = [];

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
  const utilisateur = await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant: "admin" } });
  societeId = utilisateur.societeId;
});

after(async () => {
  await prisma.journalErreur.deleteMany({
    where: { OR: [{ id: { in: idsJournal } }, { message: { startsWith: "rafale-" } }] },
  });
  await prisma.utilisateur.deleteMany({ where: { id: { in: idsUtilisateur } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("GET /api/journal-erreurs : 401 sans jeton", async () => {
  const reponse = await fetch(`${baseUrl}/api/journal-erreurs`);
  assert.equal(reponse.status, 401);
});

test("GET /api/journal-erreurs : 403 pour un rôle non-PROPRIETAIRE", async () => {
  const identifiant = `journal-test-role-${Date.now()}`;
  const cree = await prisma.utilisateur.create({
    data: { identifiant, codeHache: hacherCode("1234"), role: "CHEF", societeId },
  });
  idsUtilisateur.push(cree.id);

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const { token: tokenChef } = await reponseLogin.json();

  const reponse = await fetch(`${baseUrl}/api/journal-erreurs`, {
    headers: { Authorization: `Bearer ${tokenChef}` },
  });
  assert.equal(reponse.status, 403);
});

test("GET /api/journal-erreurs : isolation société — une entrée d'une autre société n'apparaît jamais, une entrée sans société apparaît pour tous", async () => {
  const autreSociete = await prisma.societe.create({
    data: { nom: `Autre société journal ${Date.now()}` },
  });

  const entreeAutreSociete = await prisma.journalErreur.create({
    data: { origine: "SERVEUR", message: `autre-societe-${Date.now()}`, societeId: autreSociete.id },
  });
  idsJournal.push(entreeAutreSociete.id);

  const entreeSansSociete = await prisma.journalErreur.create({
    data: { origine: "SERVEUR", message: `sans-societe-${Date.now()}`, societeId: null },
  });
  idsJournal.push(entreeSansSociete.id);

  const entreeMaSociete = await prisma.journalErreur.create({
    data: { origine: "SERVEUR", message: `ma-societe-${Date.now()}`, societeId },
  });
  idsJournal.push(entreeMaSociete.id);

  const reponse = await fetch(`${baseUrl}/api/journal-erreurs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(reponse.status, 200);
  const corps: Array<{ id: number }> = await reponse.json();
  const ids = corps.map((e) => e.id);

  assert.ok(ids.includes(entreeSansSociete.id));
  assert.ok(ids.includes(entreeMaSociete.id));
  assert.ok(!ids.includes(entreeAutreSociete.id));

  await prisma.societe.delete({ where: { id: autreSociete.id } });
});

test("POST /api/journal-erreurs/client : fonctionne sans jeton (la cause la plus probable d'un rapport est justement un jeton invalide)", async () => {
  const reponse = await fetch(`${baseUrl}/api/journal-erreurs/client`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "crash client de test", route: "/tableau-de-bord" }),
  });
  assert.equal(reponse.status, 204);

  const entree = await prisma.journalErreur.findFirst({
    where: { message: "crash client de test" },
    orderBy: { id: "desc" },
  });
  assert.ok(entree);
  assert.equal(entree!.origine, "CLIENT");
  assert.equal(entree!.societeId, null);
  idsJournal.push(entree!.id);
});

test("POST /api/journal-erreurs/client : associe société/utilisateur quand un jeton valide est fourni", async () => {
  const reponse = await fetch(`${baseUrl}/api/journal-erreurs/client`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: "crash client authentifié de test" }),
  });
  assert.equal(reponse.status, 204);

  const entree = await prisma.journalErreur.findFirst({
    where: { message: "crash client authentifié de test" },
    orderBy: { id: "desc" },
  });
  assert.ok(entree);
  assert.equal(entree!.societeId, societeId);
  idsJournal.push(entree!.id);
});

test("POST /api/journal-erreurs/client : 400 pour un corps invalide (message manquant)", async () => {
  const reponse = await fetch(`${baseUrl}/api/journal-erreurs/client`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(reponse.status, 400);
});

test("POST /api/journal-erreurs/client : 429 au-delà de la limite par IP", async () => {
  let dernierStatut = 0;
  for (let i = 0; i < 35; i++) {
    const reponse = await fetch(`${baseUrl}/api/journal-erreurs/client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `rafale-${i}` }),
    });
    dernierStatut = reponse.status;
    if (dernierStatut === 429) break;
  }
  assert.equal(dernierStatut, 429);
});
