import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel (vrai serveur Express, vrai Postgres) de GET /api/ventes/previsions —
// moyenne mobile sur les 3 dernières périodes (voir server/routes/ventes.ts). Société et compte
// dédiés, créés ici (jamais le compte "admin" partagé par le reste de la suite), même principe que
// tests/unit/menuEngineering.test.ts : ce test raisonne sur le nombre EXACT de périodes et de
// recettes de la société.

let server: Server;
let baseUrl: string;
let societeId: number;
let token: string;
let utilisateurId: number;

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
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

  const societe = await prisma.societe.create({ data: { nom: `Société prévisions ${Date.now()}` } });
  societeId = societe.id;

  const identifiant = `previsions-test-${Date.now()}`;
  const utilisateur = await prisma.utilisateur.create({
    data: { identifiant, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId },
  });
  utilisateurId = utilisateur.id;

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const corps = await reponseLogin.json();
  token = corps.token;
});

after(async () => {
  await prisma.documentVentes.deleteMany({ where: { societeId } });
  await prisma.aliasProduitVenduImport.deleteMany({ where: { recette: { societeId } } });
  await prisma.recette.deleteMany({ where: { societeId } });
  await prisma.utilisateur.delete({ where: { id: utilisateurId } });
  await prisma.societe.delete({ where: { id: societeId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function creerRecetteAvecPrix(nom: string, prixVenteHT: number): Promise<number> {
  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom, prixVenteHT, lignes: [] }),
  });
  if (reponse.status !== 201) {
    throw new Error(`creerRecetteAvecPrix a échoué (${reponse.status}) : ${await reponse.text()}`);
  }
  const corps = await reponse.json();
  return corps.id;
}

async function importerVentesValidees(
  periodeDebut: string,
  lignes: { recetteId: number; designation: string; quantite: number }[]
): Promise<void> {
  const reponse = await fetch(`${baseUrl}/api/ventes/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      periodeDebut,
      lignes: lignes.map((l) => ({
        designation: l.designation,
        quantite: String(l.quantite),
        decision: "VALIDEE",
        recetteRetenueId: l.recetteId,
      })),
    }),
  });
  if (reponse.status !== 201) {
    throw new Error(`importerVentesValidees a échoué (${reponse.status}) : ${await reponse.text()}`);
  }
  const corps = await reponse.json();
  assert.equal(corps.validees, lignes.length);
}

test("prévision par moyenne mobile, tendance, et tri chronologique par periodeDebut indépendant de l'ordre d'import", async () => {
  const suffixe = Date.now();
  const aId = await creerRecetteAvecPrix(`P Hausse ${suffixe}`, 10);
  const bId = await creerRecetteAvecPrix(`P Baisse ${suffixe}`, 15);
  const cId = await creerRecetteAvecPrix(`P Stable ${suffixe}`, 20);

  // Importées volontairement dans le désordre (période du milieu, puis la première, puis la
  // dernière) : si le tri se faisait par ordre d'import plutôt que par periodeDebut, l'historique
  // et la tendance calculés seraient faux.
  await importerVentesValidees("2026-02-01T00:00:00.000Z", [
    { recetteId: aId, designation: `P Hausse ${suffixe}`, quantite: 20 },
    { recetteId: bId, designation: `P Baisse ${suffixe}`, quantite: 20 },
    { recetteId: cId, designation: `P Stable ${suffixe}`, quantite: 30 },
  ]);
  await importerVentesValidees("2026-01-01T00:00:00.000Z", [
    { recetteId: aId, designation: `P Hausse ${suffixe}`, quantite: 10 },
    { recetteId: bId, designation: `P Baisse ${suffixe}`, quantite: 30 },
    { recetteId: cId, designation: `P Stable ${suffixe}`, quantite: 30 },
  ]);
  await importerVentesValidees("2026-03-01T00:00:00.000Z", [
    { recetteId: aId, designation: `P Hausse ${suffixe}`, quantite: 30 },
    { recetteId: bId, designation: `P Baisse ${suffixe}`, quantite: 10 },
    { recetteId: cId, designation: `P Stable ${suffixe}`, quantite: 30 },
  ]);

  const reponse = await fetch(`${baseUrl}/api/ventes/previsions`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();

  assert.equal(corps.nbPeriodes, 3);
  assert.equal(corps.items.length, 3);

  const parId = new Map<
    number,
    { historique: number[]; previsionProchainePeriode: number; tendance: string; caEstimeProchainePeriode: number | null }
  >(corps.items.map((i: { recetteId: number }) => [i.recetteId, i]));

  const a = parId.get(aId)!;
  assert.deepEqual(a.historique, [10, 20, 30]);
  assert.equal(a.previsionProchainePeriode, 20);
  assert.equal(a.tendance, "hausse");
  assert.equal(a.caEstimeProchainePeriode, 200);

  const b = parId.get(bId)!;
  assert.deepEqual(b.historique, [30, 20, 10]);
  assert.equal(b.previsionProchainePeriode, 20);
  assert.equal(b.tendance, "baisse");
  assert.equal(b.caEstimeProchainePeriode, 300);

  const c = parId.get(cId)!;
  assert.deepEqual(c.historique, [30, 30, 30]);
  assert.equal(c.previsionProchainePeriode, 30);
  assert.equal(c.tendance, "stable");
  assert.equal(c.caEstimeProchainePeriode, 600);

  assert.equal(corps.previsionQuantiteTotale, 70);
  assert.equal(corps.previsionCaTotale, 1100);
});

test("401 sans jeton d'authentification", async () => {
  const reponse = await fetch(`${baseUrl}/api/ventes/previsions`);
  assert.equal(reponse.status, 401);
});

test("historique insuffisant (moins de 2 périodes) : jamais une erreur, une liste vide", async () => {
  const autreSociete = await prisma.societe.create({ data: { nom: `Société prévisions vide ${Date.now()}` } });
  const identifiant = `previsions-vide-${Date.now()}`;
  const utilisateur = await prisma.utilisateur.create({
    data: { identifiant, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId: autreSociete.id },
  });

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const { token: tokenAutreSociete } = await reponseLogin.json();

  const reponse = await fetch(`${baseUrl}/api/ventes/previsions`, {
    headers: { Authorization: `Bearer ${tokenAutreSociete}` },
  });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.deepEqual(corps, { nbPeriodes: 0, items: [], previsionQuantiteTotale: 0, previsionCaTotale: null });

  await prisma.utilisateur.delete({ where: { id: utilisateur.id } });
  await prisma.societe.delete({ where: { id: autreSociete.id } });
});
