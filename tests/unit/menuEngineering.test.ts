import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel (vrai serveur Express, vrai Postgres) de GET /api/ventes/menu-engineering
// — méthode Kasavana & Smith (voir server/routes/ventes.ts). Société et compte dédiés, créés ici
// (jamais le compte "admin" partagé par le reste de la suite) : ce test raisonne sur la LISTE
// COMPLÈTE des recettes tarifées de la société pour vérifier des seuils calculés à la décimale
// près, ce qui exige de ne partager cette société avec aucun autre fichier de test.
//
// Recettes créées SANS aucune ligne d'ingrédient : coutParPortion = 0, donc margeUnitaire =
// prixVenteHT lui-même — un moyen simple et déterministe de contrôler la marge indépendamment de
// toute donnée d'article/tarif.

let server: Server;
let baseUrl: string;
let societeId: number;
let token: string;
let utilisateurId: number;
const recetteIds: number[] = [];
const documentIds: number[] = [];

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

  const societe = await prisma.societe.create({ data: { nom: `Société menu engineering ${Date.now()}` } });
  societeId = societe.id;

  const identifiant = `menu-engineering-test-${Date.now()}`;
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
  // Scopé par societeId (jamais par les tableaux d'ids accumulés en cours de test) : reste robuste
  // même si un test précédent a échoué avant d'avoir pu tout suivre — DocumentVentes entraîne déjà
  // ses LigneVente en cascade (voir prisma/schema.prisma, onDelete: Cascade).
  await prisma.documentVentes.deleteMany({ where: { societeId } });
  // AliasProduitVenduImport est une table globale (texteNormalise unique, jamais de societeId
  // propre, voir prisma/schema.prisma) : l'import de ventes validées ci-dessus y a appris un alias
  // par recette, qu'il faut donc effacer par recetteId avant de pouvoir supprimer ces recettes.
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
  recetteIds.push(corps.id);
  return corps.id;
}

async function importerVentesValidees(
  lignes: { recetteId: number; designation: string; quantite: number }[]
): Promise<void> {
  const reponse = await fetch(`${baseUrl}/api/ventes/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
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
  documentIds.push(corps.document.id);
}

test("classe les recettes en 4 quadrants selon popularité (quantités vendues) × rentabilité (marge)", async () => {
  const suffixe = Date.now();
  const vedetteId = await creerRecetteAvecPrix(`ME Vedette ${suffixe}`, 20);
  const chevalId = await creerRecetteAvecPrix(`ME Cheval ${suffixe}`, 5);
  const enigmeId = await creerRecetteAvecPrix(`ME Enigme ${suffixe}`, 20);
  const poidsMortId = await creerRecetteAvecPrix(`ME PoidsMort ${suffixe}`, 5);

  // total = 210, seuil popularité = 0.7 * (210/4) = 36.75 : 100 >= seuil (populaire), 5 < seuil (pas).
  // marge moyenne pondérée = (20*100 + 5*100 + 20*5 + 5*5) / 210 = 2625/210 = 12.5 : 20 >= 12.5
  // (rentable), 5 < 12.5 (pas rentable).
  await importerVentesValidees([
    { recetteId: vedetteId, designation: `ME Vedette ${suffixe}`, quantite: 100 },
    { recetteId: chevalId, designation: `ME Cheval ${suffixe}`, quantite: 100 },
    { recetteId: enigmeId, designation: `ME Enigme ${suffixe}`, quantite: 5 },
    { recetteId: poidsMortId, designation: `ME PoidsMort ${suffixe}`, quantite: 5 },
  ]);

  const reponse = await fetch(`${baseUrl}/api/ventes/menu-engineering`, { headers: authHeaders() });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();

  assert.equal(corps.items.length, 4);
  assert.ok(Math.abs(corps.seuilPopulariteQuantite - 36.75) < 0.001);
  assert.ok(Math.abs(corps.margeMoyennePonderee - 12.5) < 0.001);

  const parId = new Map<number, { quadrant: string; populaire: boolean; rentable: boolean }>(
    corps.items.map((i: { recetteId: number; quadrant: string; populaire: boolean; rentable: boolean }) => [
      i.recetteId,
      i,
    ])
  );

  assert.equal(parId.get(vedetteId)!.quadrant, "VEDETTE");
  assert.equal(parId.get(chevalId)!.quadrant, "CHEVAL_DE_TRAIT");
  assert.equal(parId.get(enigmeId)!.quadrant, "ENIGME");
  assert.equal(parId.get(poidsMortId)!.quadrant, "POIDS_MORT");
});

test("401 sans jeton d'authentification", async () => {
  const reponse = await fetch(`${baseUrl}/api/ventes/menu-engineering`);
  assert.equal(reponse.status, 401);
});

test("liste vide (jamais une erreur) quand aucune recette n'a de prix de vente configuré", async () => {
  const autreSociete = await prisma.societe.create({ data: { nom: `Société ME vide ${Date.now()}` } });
  const identifiant = `menu-engineering-vide-${Date.now()}`;
  const utilisateur = await prisma.utilisateur.create({
    data: { identifiant, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId: autreSociete.id },
  });

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const { token: tokenAutreSociete } = await reponseLogin.json();

  const reponse = await fetch(`${baseUrl}/api/ventes/menu-engineering`, {
    headers: { Authorization: `Bearer ${tokenAutreSociete}` },
  });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.deepEqual(corps, { items: [], seuilPopulariteQuantite: null, margeMoyennePonderee: null });

  await prisma.utilisateur.delete({ where: { id: utilisateur.id } });
  await prisma.societe.delete({ where: { id: autreSociete.id } });
});
