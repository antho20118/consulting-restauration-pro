import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel (vrai serveur Express, vrai jeton) de GET /api/sauvegardes et
// GET /api/sauvegardes/:nomFichier — voir tests/unit/documentsFournisseursRoute.test.ts pour le
// même principe (DOCUMENTS_STORAGE_PATH pointé vers un dossier temporaire isolé).

let server: Server;
let baseUrl: string;
let token: string;
let dossierTemporaire: string;
let dossierSauvegardes: string;

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

before(async () => {
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "sauvegardes-route-test-"));
  process.env.DOCUMENTS_STORAGE_PATH = dossierTemporaire;
  dossierSauvegardes = path.join(dossierTemporaire, "sauvegardes");

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
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }
  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: "admin", code: "1234" }),
  });
  assert.equal(reponseLogin.status, 200);
  token = (await reponseLogin.json()).token;
});

after(async () => {
  delete process.env.DOCUMENTS_STORAGE_PATH;
  await fs.rm(dossierTemporaire, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("401 sans jeton d'authentification, sur la liste comme sur le téléchargement", async () => {
  const listeSansJeton = await fetch(`${baseUrl}/api/sauvegardes`);
  assert.equal(listeSansJeton.status, 401);

  const fichierSansJeton = await fetch(`${baseUrl}/api/sauvegardes/sauvegarde-2026-01-01T00-00-00-000Z.json`);
  assert.equal(fichierSansJeton.status, 401);
});

test("GET /api/sauvegardes : liste vide (tableau, pas une erreur) quand le dossier n'existe pas encore", async () => {
  const reponse = await fetch(`${baseUrl}/api/sauvegardes`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  assert.deepEqual(await reponse.json(), []);
});

test("GET /api/sauvegardes/:nomFichier : 400 pour un nom qui ne respecte pas le format exact (jamais une tentative de lecture disque)", async () => {
  const reponse = await fetch(`${baseUrl}/api/sauvegardes/${encodeURIComponent("../../../../etc/passwd")}`, {
    headers: authHeaders(),
  });
  assert.equal(reponse.status, 400);
});

test("GET /api/sauvegardes/:nomFichier : 400 pour un nom qui a la bonne forme générale mais une extension différente", async () => {
  const reponse = await fetch(`${baseUrl}/api/sauvegardes/sauvegarde-2026-01-01T00-00-00.txt`, {
    headers: authHeaders(),
  });
  assert.equal(reponse.status, 400);
});

test("GET /api/sauvegardes/:nomFichier : 404 pour une sauvegarde inexistante mais correctement nommée", async () => {
  const reponse = await fetch(`${baseUrl}/api/sauvegardes/sauvegarde-2026-01-01T00-00-00-000Z.json`, {
    headers: authHeaders(),
  });
  assert.equal(reponse.status, 404);
});

test("liste puis télécharge une sauvegarde réellement présente sur le volume", async () => {
  await fs.mkdir(dossierSauvegardes, { recursive: true });
  const contenu = JSON.stringify({ Societe: [{ id: 1, nom: "Test" }] });
  await fs.writeFile(path.join(dossierSauvegardes, "sauvegarde-2026-06-15T10-30-00-000Z.json"), contenu, "utf8");

  const liste = await fetch(`${baseUrl}/api/sauvegardes`, { headers: authHeaders() });
  assert.equal(liste.status, 200);
  const corpsListe = await liste.json();
  assert.equal(corpsListe.length, 1);
  assert.equal(corpsListe[0].nom, "sauvegarde-2026-06-15T10-30-00-000Z.json");
  assert.equal(corpsListe[0].tailleOctets, Buffer.byteLength(contenu));
  assert.ok(corpsListe[0].creeLe);

  const telechargement = await fetch(`${baseUrl}/api/sauvegardes/sauvegarde-2026-06-15T10-30-00-000Z.json`, {
    headers: authHeaders(),
  });
  assert.equal(telechargement.status, 200);
  assert.equal(telechargement.headers.get("content-type"), "application/json");
  assert.match(telechargement.headers.get("content-disposition") ?? "", /attachment/);
  assert.equal(await telechargement.text(), contenu);
});
