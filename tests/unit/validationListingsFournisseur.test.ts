import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// PR E de l'audit F09/F10 : POST /listings-fournisseur/:fournisseurId et
// POST /listings-fournisseur/factures/:fournisseurId lisent `lignes` sans valider la structure de
// chaque élément. Ce fichier fige :
//   - les trous ROUGE à fermer par cette PR (élément null/non-objet, reference/conditionnement de
//     type non-string) : RED tant que le correctif n'est pas appliqué ;
//   - les comportements JAUNE/VERT à préserver EXACTEMENT tels quels dans cette PR (designation
//     non-string, prix, dateDocument, clé surnuméraire, champs optionnels absents/null/vides) —
//     voir le rapport d'audit F09/F10, PR E : aucun de ces points n'est arbitré ici.
//
// Migré/adapté depuis tests/unit/auditF09F10ListingsEtVentes.test.ts (audit précédent, non modifié
// par cette PR) : seules les caractérisations pertinentes au périmètre strict de PR E
// (listingsFournisseur.ts, lignes malformées) sont reprises ici ; les constats ventes.ts et le
// constat transactionnel restent dans le fichier d'audit, hors scope de cette PR.

const PREFIXE = "PR E VALIDATION TEST";

let server: Server;
let baseUrl: string;
let token: string;
let dossierTemporaire: string;
let societeId: number;
let fournisseurId: number;
const documentIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function posterListing(corps: unknown) {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corps),
  });
  const json = await reponse.json().catch(() => null);
  return { status: reponse.status, json };
}

async function posterFacture(corps: unknown) {
  const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corps),
  });
  const json = await reponse.json().catch(() => null);
  return { status: reponse.status, json };
}

before(async () => {
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "pr-e-listings-"));
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
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;

  const fournisseur = await prisma.fournisseur.create({
    data: { nom: `${PREFIXE} Fournisseur ${randomUUID()}`, societeId },
  });
  fournisseurId = fournisseur.id;
});

after(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
  delete process.env.DOCUMENTS_STORAGE_PATH;
  await fs.rm(dossierTemporaire, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

// --- ROUGE à fermer par cette PR ---

test("ROUGE : POST /:fournisseurId — reference de type nombre refusée en 400, aucune écriture (aujourd'hui 500 avec document orphelin)", async () => {
  const avant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const { status } = await posterListing({
    photoDataUrl: PNG_1X1,
    lignes: [{ designation: `${PREFIXE} Ref Nombre ${randomUUID()}`, reference: 123, prix: "1,00" }],
  });
  assert.equal(status, 400);
  assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), avant, "aucun document créé");
});

test("ROUGE : POST /:fournisseurId — conditionnement de type objet refusé en 400, aucune écriture (aujourd'hui 500)", async () => {
  const avant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const { status } = await posterListing({
    photoDataUrl: PNG_1X1,
    lignes: [{ designation: `${PREFIXE} Cond Objet ${randomUUID()}`, conditionnement: { x: 1 }, prix: "1,00" }],
  });
  assert.equal(status, 400);
  assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), avant);
});

test("ROUGE : POST /:fournisseurId — un élément null dans lignes refusé en 400, y compris la première ligne valide (aucune écriture partielle)", async () => {
  const nom = `${PREFIXE} Null Partiel ${randomUUID()}`;
  const avant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const { status } = await posterListing({
    photoDataUrl: PNG_1X1,
    lignes: [{ designation: nom, prix: "1,00" }, null],
  });
  assert.equal(status, 400);
  assert.equal(
    await prisma.documentFournisseur.count({ where: { fournisseurId } }),
    avant,
    "aucune écriture, y compris la ligne valide précédant le null (aujourd'hui : document orphelin avec 1 ligne persistée malgré le 500)"
  );
});

test("ROUGE : POST /:fournisseurId — un élément non-objet (nombre) dans lignes refusé en 400", async () => {
  const avant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const { status } = await posterListing({
    photoDataUrl: PNG_1X1,
    lignes: [{ designation: `${PREFIXE} Non Objet ${randomUUID()}`, prix: "1,00" }, 42],
  });
  assert.equal(status, 400);
  assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), avant);
});

test("ROUGE : POST /factures/:fournisseurId — un élément null dans lignes refusé en 400, aucune écriture", async () => {
  const nom = `${PREFIXE} Facture Null Partiel ${randomUUID()}`;
  const avant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const { status } = await posterFacture({
    photoDataUrl: PNG_1X1,
    numero: `PR-E-${randomUUID()}`,
    lignes: [{ designation: nom, prix: "1,00" }, null],
  });
  assert.equal(status, 400);
  assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), avant);
});

test("ROUGE : POST /factures/:fournisseurId — reference de type nombre refusée en 400, aucune écriture", async () => {
  const avant = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const { status } = await posterFacture({
    photoDataUrl: PNG_1X1,
    numero: `PR-E-${randomUUID()}`,
    lignes: [{ designation: `${PREFIXE} Facture Ref Nombre ${randomUUID()}`, reference: 123, prix: "1,00" }],
  });
  assert.equal(status, 400);
  assert.equal(await prisma.documentFournisseur.count({ where: { fournisseurId } }), avant);
});

// --- JAUNE/VERT à préserver EXACTEMENT tels quels dans cette PR ---

test("CARACTÉRISATION (doit rester inchangé) : reference absente -> toujours accepté, 201", async () => {
  const nom = `${PREFIXE} Ref Absente ${randomUUID()}`;
  const { status, json } = await posterListing({ photoDataUrl: PNG_1X1, lignes: [{ designation: nom, prix: "1,00" }] });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
});

test("CARACTÉRISATION (doit rester inchangé) : reference explicitement null -> toujours accepté, 201", async () => {
  const nom = `${PREFIXE} Ref Null ${randomUUID()}`;
  const { status, json } = await posterListing({
    photoDataUrl: PNG_1X1,
    lignes: [{ designation: nom, reference: null, prix: "1,00" }],
  });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
});

test("CARACTÉRISATION (doit rester inchangé) : reference chaîne vide -> toujours accepté, 201", async () => {
  const nom = `${PREFIXE} Ref Vide ${randomUUID()}`;
  const { status, json } = await posterListing({
    photoDataUrl: PNG_1X1,
    lignes: [{ designation: nom, reference: "", prix: "1,00" }],
  });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
});

test("CARACTÉRISATION (doit rester inchangé) : conditionnement absent, null ou vide -> toujours accepté, 201", async () => {
  for (const conditionnement of [undefined, null, ""]) {
    const nom = `${PREFIXE} Cond ${String(conditionnement)} ${randomUUID()}`;
    const ligne: Record<string, unknown> = { designation: nom, prix: "1,00" };
    if (conditionnement !== undefined) ligne.conditionnement = conditionnement;
    const { status, json } = await posterListing({ photoDataUrl: PNG_1X1, lignes: [ligne] });
    assert.equal(status, 201, `conditionnement=${JSON.stringify(conditionnement)} doit rester accepté`);
    documentIds.push(json.document.id);
  }
});

test("CARACTÉRISATION (doit rester inchangé) : clé surnuméraire (societeId) dans le corps toujours ignorée", async () => {
  const nom = `${PREFIXE} Cle Inconnue ${randomUUID()}`;
  const { status, json } = await posterListing({
    societeId: 999999,
    photoDataUrl: PNG_1X1,
    lignes: [{ designation: nom, prix: "1,00" }],
  });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
});

test("CARACTÉRISATION (doit rester inchangé dans cette PR) : designation de type objet reste acceptée et coercée en \"[object Object]\" — JAUNE non arbitré", async () => {
  const { status, json } = await posterListing({
    photoDataUrl: PNG_1X1,
    lignes: [{ designation: { a: 1 }, prix: "1,00" }],
  });
  assert.equal(status, 201, "cette PR ne touche jamais à la validation de designation (hors scope, JAUNE)");
  documentIds.push(json.document.id);
  assert.equal(json.lignes[0].designationLue, "[object Object]");
});

test("CARACTÉRISATION (doit rester inchangé dans cette PR) : prix négatif reste accepté tel quel — JAUNE non arbitré", async () => {
  const nom = `${PREFIXE} Prix Negatif ${randomUUID()}`;
  const { status, json } = await posterListing({ photoDataUrl: PNG_1X1, lignes: [{ designation: nom, prix: "-50,00" }] });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
  assert.equal(json.lignes[0].prixLu, -50);
});
