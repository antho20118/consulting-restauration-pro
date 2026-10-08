import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// PR F de l'audit F09/F10 : POST /ventes/import crashait en 500 (écriture partielle) sur un
// élément null/non-objet dans `lignes`, ou sur periodeDebut/periodeFin non parsable par
// `new Date(...)`. Ce fichier fige :
//   - les trous ROUGE à fermer par cette PR : RED tant que le correctif n'est pas appliqué ;
//   - les comportements hors scope à préserver EXACTEMENT tels quels (decision inconnue,
//     quantite/prixUnitaire/recetteRetenueId, clés surnuméraires, dates absentes/null/vides) —
//     voir le rapport d'audit F09/F10, PR F : aucun de ces points n'est arbitré ici.
//
// Migré/adapté depuis tests/unit/auditF09F10ListingsEtVentes.test.ts (audit précédent, non
// modifié par cette PR) : seules les caractérisations pertinentes au périmètre strict de PR F
// (ventes.ts, POST /import) sont reprises ici.

const PREFIXE = "PR F VALIDATION TEST";

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
const documentIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function posterImport(corps: unknown) {
  const reponse = await fetch(`${baseUrl}/api/ventes/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corps),
  });
  const json = await reponse.json().catch(() => null);
  return { status: reponse.status, json };
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

  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
});

after(async () => {
  await prisma.ligneVente.deleteMany({ where: { documentVentesId: { in: documentIds } } });
  await prisma.documentVentes.deleteMany({ where: { id: { in: documentIds } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

// --- ROUGE à fermer par cette PR ---

test("ROUGE : POST /import — un élément null dans lignes refusé en 400, aucune écriture (aujourd'hui 500 + écriture partielle)", async () => {
  const avant = await prisma.documentVentes.count({ where: { societeId } });
  const { status } = await posterImport({
    lignes: [{ designation: `${PREFIXE} Null Partiel ${randomUUID()}`, quantite: "1", decision: "REJETEE" }, null],
  });
  assert.equal(status, 400);
  assert.equal(await prisma.documentVentes.count({ where: { societeId } }), avant, "aucun DocumentVentes créé, y compris la ligne valide précédant le null");
});

test("ROUGE : POST /import — un élément non-objet (nombre) dans lignes refusé en 400, aucune écriture", async () => {
  const avant = await prisma.documentVentes.count({ where: { societeId } });
  const { status } = await posterImport({
    lignes: [{ designation: `${PREFIXE} Non Objet ${randomUUID()}`, quantite: "1", decision: "REJETEE" }, 42],
  });
  assert.equal(status, 400);
  assert.equal(await prisma.documentVentes.count({ where: { societeId } }), avant);
});

test("ROUGE : POST /import — periodeDebut non parsable refusée en 400, aucune écriture (aujourd'hui 500)", async () => {
  const avant = await prisma.documentVentes.count({ where: { societeId } });
  const { status } = await posterImport({
    periodeDebut: "pas-une-date",
    lignes: [{ designation: `${PREFIXE} Periode Debut Invalide ${randomUUID()}`, quantite: "1", decision: "REJETEE" }],
  });
  assert.equal(status, 400);
  assert.equal(await prisma.documentVentes.count({ where: { societeId } }), avant);
});

test("ROUGE : POST /import — periodeFin non parsable refusée en 400, aucune écriture (aujourd'hui 500)", async () => {
  const avant = await prisma.documentVentes.count({ where: { societeId } });
  const { status } = await posterImport({
    periodeFin: "pas-une-date",
    lignes: [{ designation: `${PREFIXE} Periode Fin Invalide ${randomUUID()}`, quantite: "1", decision: "REJETEE" }],
  });
  assert.equal(status, 400);
  assert.equal(await prisma.documentVentes.count({ where: { societeId } }), avant);
});

// --- Caractérisations à préserver EXACTEMENT telles quelles dans cette PR ---

test("CARACTÉRISATION (doit rester inchangé) : periodeDebut/periodeFin absentes -> toujours null, 201", async () => {
  const { status, json } = await posterImport({
    lignes: [{ designation: `${PREFIXE} Dates Absentes ${randomUUID()}`, quantite: "1", decision: "REJETEE" }],
  });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
  assert.equal(json.document.periodeDebut, null);
  assert.equal(json.document.periodeFin, null);
});

test("CARACTÉRISATION (doit rester inchangé) : periodeDebut/periodeFin explicitement null -> toujours null, 201", async () => {
  const { status, json } = await posterImport({
    periodeDebut: null,
    periodeFin: null,
    lignes: [{ designation: `${PREFIXE} Dates Null ${randomUUID()}`, quantite: "1", decision: "REJETEE" }],
  });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
  assert.equal(json.document.periodeDebut, null);
  assert.equal(json.document.periodeFin, null);
});

test("CARACTÉRISATION (doit rester inchangé) : periodeDebut/periodeFin chaîne vide -> toujours null, 201", async () => {
  const { status, json } = await posterImport({
    periodeDebut: "",
    periodeFin: "",
    lignes: [{ designation: `${PREFIXE} Dates Vides ${randomUUID()}`, quantite: "1", decision: "REJETEE" }],
  });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
  assert.equal(json.document.periodeDebut, null);
  assert.equal(json.document.periodeFin, null);
});

test("CARACTÉRISATION (doit rester inchangé) : periodeDebut/periodeFin valides -> correctement persistées, 201", async () => {
  const { status, json } = await posterImport({
    periodeDebut: "2026-01-01",
    periodeFin: "2026-01-31",
    lignes: [{ designation: `${PREFIXE} Dates Valides ${randomUUID()}`, quantite: "1", decision: "REJETEE" }],
  });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
  assert.ok(json.document.periodeDebut);
  assert.ok(json.document.periodeFin);
});

test("CARACTÉRISATION (doit rester inchangé) : decision inconnue conserve exactement son comportement actuel (traitée comme tentative de VALIDEE, jamais rejetée en 400)", async () => {
  const { status, json } = await posterImport({
    lignes: [{ designation: `${PREFIXE} Decision Bizarre ${randomUUID()}`, quantite: "1", decision: "AUTRE_CHOSE" }],
  });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
  assert.equal(json.enAttente, 1);
});

test("CARACTÉRISATION (doit rester inchangé) : quantite négative/zéro/NaN/Infinity gardent leur traitement actuel (ligne ignorée, jamais un crash)", async () => {
  for (const q of [-5, 0, "NaN", "Infinity"]) {
    const { status, json } = await posterImport({
      lignes: [{ designation: `${PREFIXE} Quantite ${q} ${randomUUID()}`, quantite: q, decision: "REJETEE" }],
    });
    assert.equal(status, 201, `quantite=${q} ne doit jamais crasher`);
    documentIds.push(json.document.id);
    assert.equal(json.validees, 0);
    assert.equal(json.rejetees, 0);
    assert.equal(json.enAttente, 0);
  }
});

test("CARACTÉRISATION (doit rester inchangé) : recetteRetenueId invalide garde son comportement actuel (non conforme, mise en attente)", async () => {
  const { status, json } = await posterImport({
    lignes: [
      { designation: `${PREFIXE} Recette Invalide ${randomUUID()}`, quantite: "1", decision: "VALIDEE", recetteRetenueId: 999999999 },
    ],
  });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
  assert.equal(json.enAttente, 1);
  assert.equal(json.validees, 0);
});

test("CARACTÉRISATION (doit rester inchangé) : clé surnuméraire dans le corps toujours ignorée", async () => {
  const { status, json } = await posterImport({
    societeId: 999999,
    lignes: [{ designation: `${PREFIXE} Cle Inconnue ${randomUUID()}`, quantite: "1", decision: "REJETEE" }],
  });
  assert.equal(status, 201);
  documentIds.push(json.document.id);
  assert.equal(json.document.societeId, societeId, "la société réelle du compte connecté, jamais celle du corps");
});
