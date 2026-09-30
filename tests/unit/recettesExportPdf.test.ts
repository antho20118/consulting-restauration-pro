import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel de GET /api/recettes/:id/export-pdf — même donnée que GET /:id
// (calculerCoutRecette), mise en forme en PDF par server/utils/pdf/ficheRecettePdf.tsx. Société et
// compte dédiés (même principe que tests/unit/menuEngineering.test.ts), pas de vérification du
// contenu visuel du PDF (hors de portée d'un test automatisé) : seulement que le fichier produit
// est bien un PDF valide, nommé et servi comme un téléchargement.

let server: Server;
let baseUrl: string;
let societeId: number;
let token: string;
let utilisateurId: number;
let recetteId: number;

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

  const societe = await prisma.societe.create({ data: { nom: `Société export PDF ${Date.now()}` } });
  societeId = societe.id;

  const identifiant = `export-pdf-test-${Date.now()}`;
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

  const reponseRecette = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      nom: `Recette export PDF ${Date.now()}`,
      prixVenteHT: 15,
      portions: 4,
      instructions: "Note complémentaire de test.",
      lignes: [],
      etapes: [{ ordre: 1, description: "Préparer les ingrédients.", pointCritiqueHACCP: false }],
    }),
  });
  if (reponseRecette.status !== 201) {
    throw new Error(`Création de la recette de test a échoué (${reponseRecette.status}) : ${await reponseRecette.text()}`);
  }
  recetteId = (await reponseRecette.json()).id;
});

after(async () => {
  await prisma.recette.deleteMany({ where: { societeId } });
  await prisma.utilisateur.delete({ where: { id: utilisateurId } });
  await prisma.societe.delete({ where: { id: societeId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("GET /recettes/:id/export-pdf renvoie un vrai fichier PDF téléchargeable", async () => {
  const reponse = await fetch(`${baseUrl}/api/recettes/${recetteId}/export-pdf`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  assert.equal(reponse.headers.get("content-type"), "application/pdf");
  assert.match(reponse.headers.get("content-disposition") ?? "", /attachment; filename="fiche-.+\.pdf"/);

  const octets = new Uint8Array(await reponse.arrayBuffer());
  assert.ok(octets.length > 500, "le PDF généré ne doit pas être vide ou tronqué");
  // Signature PDF standard : tout fichier .pdf valide commence par "%PDF-".
  const entete = Buffer.from(octets.slice(0, 5)).toString("ascii");
  assert.equal(entete, "%PDF-");
});

test("GET /recettes/:id/export-pdf : 404 pour une recette inexistante", async () => {
  const reponse = await fetch(`${baseUrl}/api/recettes/999999999/export-pdf`, { headers: authHeaders() });
  assert.equal(reponse.status, 404);
});

test("401 sans jeton d'authentification", async () => {
  const reponse = await fetch(`${baseUrl}/api/recettes/${recetteId}/export-pdf`);
  assert.equal(reponse.status, 401);
});
