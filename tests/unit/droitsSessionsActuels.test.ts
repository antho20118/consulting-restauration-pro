import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Les droits d'une requête sont ceux du compte AU MOMENT de la requête, pas ceux inscrits dans le
// jeton à la connexion (valable 12 h) — voir server/middleware/requireAuth.ts. Constat de l'audit du
// 15/10 : un PROPRIETAIRE rétrogradé en CUISINIER pouvait encore créer un compte PROPRIETAIRE avec
// son ancien jeton, et un code réinitialisé laissait les anciennes connexions actives. Société
// dédiée à ce fichier ; 6 connexions au total, sous la limite de tentatives de connexion.

let server: Server;
let baseUrl: string;
let societeId: number;
const marqueur = `DROITS-SESSIONS-${randomUUID()}`;
const CODE = "code-initial-1234";

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
});

after(async () => {
  try {
    await prisma.categorie.deleteMany({ where: { societeId } });
    await prisma.utilisateur.deleteMany({ where: { societeId } });
    await prisma.societe.deleteMany({ where: { id: societeId } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

async function compte(suffixe: string, role: "PROPRIETAIRE" | "CHEF" | "CUISINIER") {
  return prisma.utilisateur.create({
    data: { identifiant: `${marqueur}-${suffixe}`, codeHache: hacherCode(CODE), role, societeId },
  });
}

async function connecter(identifiant: string, code = CODE): Promise<string> {
  const reponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code }),
  });
  assert.equal(reponse.status, 200, `connexion de ${identifiant}`);
  return ((await reponse.json()) as { token: string }).token;
}

function appel(token: string, method: string, chemin: string, body?: unknown) {
  return fetch(`${baseUrl}/api${chemin}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("un PROPRIETAIRE rétrogradé perd immédiatement la gestion des comptes, même avec son jeton d'avant", async () => {
  const patron = await compte("patron", "PROPRIETAIRE");
  const second = await compte("second", "PROPRIETAIRE");
  const jetonPatron = await connecter(patron.identifiant);
  const jetonSecond = await connecter(second.identifiant);

  const retrogradation = await appel(jetonPatron, "PUT", `/utilisateurs/${second.id}`, { role: "CUISINIER" });
  assert.equal(retrogradation.status, 200);

  const tentative = await appel(jetonSecond, "POST", "/utilisateurs", {
    identifiant: `${marqueur}-intrus`,
    code: CODE,
    role: "PROPRIETAIRE",
  });
  assert.equal(tentative.status, 403);
  assert.equal(await prisma.utilisateur.findUnique({ where: { identifiant: `${marqueur}-intrus` } }), null);
});

test("un CUISINIER promu CHEF obtient immédiatement les droits de CHEF, sans se reconnecter", async () => {
  const patron = await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant: `${marqueur}-patron` } });
  const cuisinier = await compte("promu", "CUISINIER");
  const jetonCuisinier = await connecter(cuisinier.identifiant);
  const jetonPatron = await connecter(patron.identifiant);

  const avant = await appel(jetonCuisinier, "POST", "/categories", { nom: `${marqueur} avant` });
  assert.equal(avant.status, 403, "un CUISINIER ne gère pas les catégories");

  assert.equal((await appel(jetonPatron, "PUT", `/utilisateurs/${cuisinier.id}`, { role: "CHEF" })).status, 200);
  const apres = await appel(jetonCuisinier, "POST", "/categories", { nom: `${marqueur} après` });
  assert.equal(apres.status, 201);
});

test("un code réinitialisé par le PROPRIETAIRE ferme les connexions ouvertes avec l'ancien code", async () => {
  const patron = await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant: `${marqueur}-patron` } });
  const chef = await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant: `${marqueur}-promu` } });
  const jetonPatron = await connecter(patron.identifiant);
  // Jeton du chef obtenu AVANT la réinitialisation (connexion du test précédent, rejouée ici).
  const ancienJetonChef = await connecter(chef.identifiant);
  assert.equal((await appel(ancienJetonChef, "GET", "/categories")).status, 200);

  // Une seconde d'écart : un jeton émis dans la seconde même de l'invalidation reste accepté.
  await new Promise((r) => setTimeout(r, 1100));
  const reinit = await appel(jetonPatron, "POST", `/utilisateurs/${chef.id}/reinitialiser-code`, {
    nouveauCode: "nouveau-code-5678",
  });
  assert.equal(reinit.status, 204);

  assert.equal((await appel(ancienJetonChef, "GET", "/categories")).status, 401);
  assert.equal((await appel(jetonPatron, "GET", "/categories")).status, 200, "les autres comptes ne sont pas touchés");
});

test("changer son propre code ferme ses autres connexions, mais le jeton renvoyé reste valable", async () => {
  const patron = await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant: `${marqueur}-patron` } });
  const jetonAutreAppareil = await connecter(patron.identifiant);
  await new Promise((r) => setTimeout(r, 1100));

  const changement = await appel(jetonAutreAppareil, "PUT", "/auth/moi", {
    codeActuel: CODE,
    nouvelIdentifiant: patron.identifiant,
    nouveauCode: "patron-nouveau-9012",
  });
  assert.equal(changement.status, 200);
  const nouveauJeton = ((await changement.json()) as { token: string }).token;

  assert.equal((await appel(jetonAutreAppareil, "GET", "/categories")).status, 401);
  assert.equal((await appel(nouveauJeton, "GET", "/categories")).status, 200);
});
