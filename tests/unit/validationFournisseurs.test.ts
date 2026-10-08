import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// PR D de l'audit F09/F10 : POST et PUT /api/fournisseurs lisent nom/telephone/email/siteWeb
// directement depuis req.body sans aucune validation Zod. Ce fichier caractérise d'abord le
// comportement RÉEL actuel (avant tout correctif) : certains cas sont déjà corrects et doivent
// être préservés tels quels (non-régression), d'autres sont des trous F09 à fermer (rouge).
//
// Vrai serveur Express, vrai jeton (voir identiteFournisseurProduitFournisseur.test.ts pour le
// même principe sur ce routeur) : jamais de mock de req/res.

const PREFIXE = "VALIDATION PR D TEST";

let server: Server;
let baseUrl: string;
let token: string;

function authHeaders() {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function poster(corpsPayload: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsPayload),
  });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
}

async function mettreAJour(id: number, corpsPayload: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(corpsPayload),
  });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
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
  await prisma.fournisseur.deleteMany({ where: { nom: { startsWith: PREFIXE } } });
  await prisma.fournisseur.deleteMany({ where: { nom: "" } });
  await prisma.fournisseur.deleteMany({ where: { nom: "   " } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

// --- ROUGE : nom vide / blanc (POST) ---

test("POST /api/fournisseurs : nom vide refusé en 400, aucune création (aujourd'hui accepté à tort, 201)", async () => {
  const { status } = await poster({ nom: "" });
  assert.equal(status, 400);
  const creee = await prisma.fournisseur.findFirst({ where: { nom: "" } });
  assert.equal(creee, null, "aucun fournisseur ne doit être créé avec un nom vide");
});

test("POST /api/fournisseurs : nom composé uniquement d'espaces refusé en 400 (aujourd'hui accepté à tort, 201)", async () => {
  const { status } = await poster({ nom: "   " });
  assert.equal(status, 400);
  const creee = await prisma.fournisseur.findFirst({ where: { nom: "   " } });
  assert.equal(creee, null, "aucun fournisseur ne doit être créé avec un nom blanc");
});

// --- ROUGE : type manifestement invalide sur un champ optionnel (POST) ---
// Aujourd'hui : PrismaClientValidationError non interceptée -> 500 générique (fuite de détail
// Prisma en log serveur, message générique côté client mais mauvais code HTTP : un type invalide
// est une erreur du client, pas une panne serveur).

test("POST /api/fournisseurs : telephone de type nombre refusé en 400, pas 500 (aujourd'hui 500)", async () => {
  const nom = `${PREFIXE} Telephone Nombre ${randomUUID()}`;
  const { status } = await poster({ nom, telephone: 123 });
  assert.equal(status, 400);
  const creee = await prisma.fournisseur.findFirst({ where: { nom } });
  assert.equal(creee, null, "aucun fournisseur ne doit être créé avec un telephone de type invalide");
});

test("POST /api/fournisseurs : email de type tableau refusé en 400, pas 500 (aujourd'hui 500)", async () => {
  const nom = `${PREFIXE} Email Tableau ${randomUUID()}`;
  const { status } = await poster({ nom, email: ["a@b.com"] });
  assert.equal(status, 400);
  const creee = await prisma.fournisseur.findFirst({ where: { nom } });
  assert.equal(creee, null, "aucun fournisseur ne doit être créé avec un email de type invalide");
});

test("POST /api/fournisseurs : siteWeb de type objet refusé en 400, pas 500 (aujourd'hui 500)", async () => {
  const nom = `${PREFIXE} SiteWeb Objet ${randomUUID()}`;
  const { status } = await poster({ nom, siteWeb: { x: 1 } });
  assert.equal(status, 400);
  const creee = await prisma.fournisseur.findFirst({ where: { nom } });
  assert.equal(creee, null, "aucun fournisseur ne doit être créé avec un siteWeb de type invalide");
});

// --- CARACTÉRISATION (déjà vert aujourd'hui, à préserver) : champs optionnels omis/vides sur POST ---

test("CARACTÉRISATION : POST avec seulement nom (telephone/email/siteWeb absents) reste accepté, tous null", async () => {
  const nom = `${PREFIXE} Seulement Nom ${randomUUID()}`;
  const { status, corps } = await poster({ nom });
  assert.equal(status, 201);
  assert.equal(corps.telephone, null);
  assert.equal(corps.email, null);
  assert.equal(corps.siteWeb, null);
});

test("CARACTÉRISATION : POST avec telephone/email/siteWeb en chaîne vide reste accepté, tous convertis en null", async () => {
  const nom = `${PREFIXE} Chaines Vides ${randomUUID()}`;
  const { status, corps } = await poster({ nom, telephone: "", email: "", siteWeb: "" });
  assert.equal(status, 201);
  assert.equal(corps.telephone, null);
  assert.equal(corps.email, null);
  assert.equal(corps.siteWeb, null);
});

// Angle mort signalé avant le correctif : `null || null` vaut `null` en JS, donc un `null` explicite
// envoyé par le client est déjà accepté aujourd'hui exactement comme une chaîne vide ou une absence
// de champ. Un schéma Zod `z.string().optional()` (sans `.nullable()`) rejetterait ce `null` à tort
// — rupture de contrat. Vérifié ici avant d'écrire le schéma définitif.
test("CARACTÉRISATION : POST avec telephone/email/siteWeb explicitement à null reste accepté, tous null", async () => {
  const nom = `${PREFIXE} Null Explicite POST ${randomUUID()}`;
  const { status, corps } = await poster({ nom, telephone: null, email: null, siteWeb: null });
  assert.equal(status, 201);
  assert.equal(corps.telephone, null);
  assert.equal(corps.email, null);
  assert.equal(corps.siteWeb, null);
});

// --- ROUGE : nom vide (PUT) ---

test("PUT /api/fournisseurs/:id : nom vide refusé en 400, aucune modification (aujourd'hui accepté à tort, 200)", async () => {
  const fournisseur = await prisma.fournisseur.create({
    data: { nom: `${PREFIXE} PUT nom vide ${randomUUID()}`, societeId: (await prisma.societe.findFirstOrThrow({ orderBy: { id: "asc" } })).id },
  });
  const nomOriginal = fournisseur.nom;
  const { status } = await mettreAJour(fournisseur.id, { nom: "" });
  assert.equal(status, 400);
  const relu = await prisma.fournisseur.findUniqueOrThrow({ where: { id: fournisseur.id } });
  assert.equal(relu.nom, nomOriginal, "le nom ne doit pas avoir été écrasé par une valeur vide");
  await prisma.fournisseur.deleteMany({ where: { id: fournisseur.id } });
});

// --- ROUGE : type manifestement invalide sur PUT (même défaut que POST) ---

test("PUT /api/fournisseurs/:id : telephone de type nombre refusé en 400, pas 500 (aujourd'hui 500)", async () => {
  const fournisseur = await prisma.fournisseur.create({
    data: { nom: `${PREFIXE} PUT type invalide ${randomUUID()}`, societeId: (await prisma.societe.findFirstOrThrow({ orderBy: { id: "asc" } })).id },
  });
  const { status } = await mettreAJour(fournisseur.id, { nom: fournisseur.nom, telephone: 123 });
  assert.equal(status, 400);
  await prisma.fournisseur.deleteMany({ where: { id: fournisseur.id } });
});

// --- CARACTÉRISATION (déjà vert aujourd'hui) : PUT sans nom laisse le nom existant inchangé ---
// Comportement non trivial : `nom` est passé tel quel à Prisma (data: { nom, ... }), donc un `nom`
// omis (=== undefined) est ignoré par Prisma update (jamais écrasé) — alors que telephone/email/
// siteWeb sont systématiquement réécrits via `|| null`, donc omis => activement remis à null (pas
// ignorés). Deux comportements différents pour des champs qui semblent symétriques dans le code.
// Aucun test ni appelant frontend n'exerce aujourd'hui ce cas (FournisseurForm envoie toujours les
// 4 champs) : c'est un effet de bord du code existant, jamais un contrat délibéré. Reporté tel quel
// pour que la décision de le préserver ou non revienne à l'utilisateur, pas à moi.

test("CARACTÉRISATION : PUT sans nom laisse le nom existant inchangé, mais remet telephone/email/siteWeb omis à null", async () => {
  const societeId = (await prisma.societe.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
  const fournisseur = await prisma.fournisseur.create({
    data: {
      nom: `${PREFIXE} PUT partiel ${randomUUID()}`,
      telephone: "0102030405",
      email: "x@y.com",
      siteWeb: "https://x.com",
      societeId,
    },
  });
  const nomOriginal = fournisseur.nom;

  const { status } = await mettreAJour(fournisseur.id, { telephone: "0000000000" });
  assert.equal(status, 200);

  const relu = await prisma.fournisseur.findUniqueOrThrow({ where: { id: fournisseur.id } });
  assert.equal(relu.nom, nomOriginal, "le nom omis n'est jamais écrasé (comportement Prisma update + undefined)");
  assert.equal(relu.telephone, "0000000000");
  assert.equal(relu.email, null, "email omis est activement remis à null, pas préservé");
  assert.equal(relu.siteWeb, null, "siteWeb omis est activement remis à null, pas préservé");

  await prisma.fournisseur.deleteMany({ where: { id: fournisseur.id } });
});

test("CARACTÉRISATION : PUT avec telephone/email/siteWeb explicitement à null reste accepté, tous null", async () => {
  const societeId = (await prisma.societe.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
  const fournisseur = await prisma.fournisseur.create({
    data: {
      nom: `${PREFIXE} PUT null explicite ${randomUUID()}`,
      telephone: "0102030405",
      email: "x@y.com",
      siteWeb: "https://x.com",
      societeId,
    },
  });

  const { status, corps } = await mettreAJour(fournisseur.id, {
    nom: fournisseur.nom,
    telephone: null,
    email: null,
    siteWeb: null,
  });
  assert.equal(status, 200);
  assert.equal(corps.telephone, null);
  assert.equal(corps.email, null);
  assert.equal(corps.siteWeb, null);

  await prisma.fournisseur.deleteMany({ where: { id: fournisseur.id } });
});

// Demandé explicitement : PUT {} (corps vide, pas même un seul champ) sur un fournisseur qui a
// déjà téléphone/email/siteWeb renseignés, pour confirmer noir sur blanc — sans aucune ambiguïté
// liée à la présence d'un autre champ dans le corps — que les 3 sont bien remis à null alors que
// nom reste inchangé.
test("CARACTÉRISATION : PUT {} (corps totalement vide) remet telephone/email/siteWeb à null, nom inchangé", async () => {
  const societeId = (await prisma.societe.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
  const fournisseur = await prisma.fournisseur.create({
    data: {
      nom: `${PREFIXE} PUT corps vide ${randomUUID()}`,
      telephone: "0102030405",
      email: "x@y.com",
      siteWeb: "https://x.com",
      societeId,
    },
  });
  const nomOriginal = fournisseur.nom;

  const { status } = await mettreAJour(fournisseur.id, {});
  assert.equal(status, 200);

  const relu = await prisma.fournisseur.findUniqueOrThrow({ where: { id: fournisseur.id } });
  assert.equal(relu.nom, nomOriginal, "nom inchangé malgré un corps vide");
  assert.equal(relu.telephone, null, "telephone remis à null par un corps vide");
  assert.equal(relu.email, null, "email remis à null par un corps vide");
  assert.equal(relu.siteWeb, null, "siteWeb remis à null par un corps vide");

  await prisma.fournisseur.deleteMany({ where: { id: fournisseur.id } });
});

// --- CARACTÉRISATION (déjà vert aujourd'hui) : clé inconnue silencieusement ignorée ---
// Voir aussi erreursEcritureFK.test.ts, test 2 (POST avec societeId) : ce comportement est déjà
// couvert et DOIT rester vrai — jamais de schéma .strict() sur ce routeur sans casser ce test.

test("CARACTÉRISATION : PUT avec une clé inconnue (societeId) l'ignore silencieusement, ne modifie jamais la société", async () => {
  const societeId = (await prisma.societe.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
  const fournisseur = await prisma.fournisseur.create({
    data: { nom: `${PREFIXE} PUT cle inconnue ${randomUUID()}`, societeId },
  });

  const { status } = await mettreAJour(fournisseur.id, { nom: fournisseur.nom, societeId: 999999999 });
  assert.equal(status, 200);

  const relu = await prisma.fournisseur.findUniqueOrThrow({ where: { id: fournisseur.id } });
  assert.equal(relu.societeId, societeId, "societeId ne doit jamais être modifiable depuis le corps de la requête");

  await prisma.fournisseur.deleteMany({ where: { id: fournisseur.id } });
});
