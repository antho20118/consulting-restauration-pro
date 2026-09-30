import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";
import { enregistrerDocument } from "../../server/utils/storageDocumentsFournisseur.js";

// Test d'intégration réel (vrai serveur Express, vrai Postgres, vrai JWT) de la route
// GET /api/documents-fournisseurs/:fournisseurId/:cle — voir tests/unit/articles.test.ts pour le
// même principe. Phase 1 du chantier listings/factures : cette route ne dépend d'aucun modèle
// Prisma nouveau (arrivera en Phase 2), seulement du module de stockage sur disque.

let server: Server;
let baseUrl: string;
let token: string;
let dossierTemporaire: string;
let fournisseurId: number;

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

before(async () => {
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "storage-documents-route-test-"));
  process.env.DOCUMENTS_STORAGE_PATH = dossierTemporaire;

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  token = await connecterAdminDeTest(baseUrl);

  const societe =
    (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  const fournisseur = await prisma.fournisseur.create({
    data: { nom: "DOCUMENTS FOURNISSEUR TEST Route", societeId: societe.id },
  });
  fournisseurId = fournisseur.id;
});

after(async () => {
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
  delete process.env.DOCUMENTS_STORAGE_PATH;
  await fs.rm(dossierTemporaire, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("401 sans jeton d'authentification (la route hérite bien de requireAuth)", async () => {
  const reponse = await fetch(`${baseUrl}/api/documents-fournisseurs/${fournisseurId}/00000000-0000-4000-8000-000000000000`);
  assert.equal(reponse.status, 401);
});

test("404 pour un document qui n'existe pas", async () => {
  const reponse = await fetch(
    `${baseUrl}/api/documents-fournisseurs/${fournisseurId}/00000000-0000-4000-8000-000000000000`,
    { headers: authHeaders() }
  );
  assert.equal(reponse.status, 404);
});

test("400 pour une clé mal formée (pas une tentative de lecture disque)", async () => {
  const reponse = await fetch(`${baseUrl}/api/documents-fournisseurs/${fournisseurId}/pas-un-uuid`, {
    headers: authHeaders(),
  });
  assert.equal(reponse.status, 400);
});

test("400 pour une tentative de directory traversal dans le paramètre clé", async () => {
  const reponse = await fetch(
    `${baseUrl}/api/documents-fournisseurs/${fournisseurId}/${encodeURIComponent("../../../../etc/passwd")}`,
    { headers: authHeaders() }
  );
  assert.equal(reponse.status, 400);
});

test("400 pour un fournisseurId non numérique", async () => {
  const reponse = await fetch(
    `${baseUrl}/api/documents-fournisseurs/abc/00000000-0000-4000-8000-000000000000`,
    { headers: authHeaders() }
  );
  assert.equal(reponse.status, 400);
});

test("200 avec le bon Content-Type et les bons octets pour un document réellement stocké", async () => {
  const stocke = await enregistrerDocument({ fournisseurId, dataUrl: PNG_1X1 });

  const reponse = await fetch(`${baseUrl}/api/documents-fournisseurs/${fournisseurId}/${stocke.cle}`, {
    headers: authHeaders(),
  });

  assert.equal(reponse.status, 200);
  assert.equal(reponse.headers.get("content-type"), "image/png");
  assert.equal(reponse.headers.get("cache-control"), "private, no-store");

  const octetsRecus = Buffer.from(await reponse.arrayBuffer());
  const octetsAttendus = Buffer.from(PNG_1X1.split(",")[1], "base64");
  assert.equal(octetsRecus.equals(octetsAttendus), true);
});

test("404 pour un document d'un AUTRE fournisseur (la clé ne se substitue pas au fournisseurId)", async () => {
  const stocke = await enregistrerDocument({ fournisseurId, dataUrl: PNG_1X1 });

  const reponse = await fetch(`${baseUrl}/api/documents-fournisseurs/999999/${stocke.cle}`, {
    headers: authHeaders(),
  });
  assert.equal(reponse.status, 404);
});
