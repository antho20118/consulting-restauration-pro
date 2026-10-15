import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Limite des tentatives de connexion (server/routes/auth.ts), constat de l'audit du 15/10 :
// - elle comptait aussi les connexions RÉUSSIES : 10 connexions normales en 15 minutes (une équipe
//   qui prend son service) bloquaient la suivante ;
// - elle ne voyait que l'adresse du proxy de Railway (Express ne lisait pas X-Forwarded-For) : toute
//   l'équipe partageait donc un seul compteur.
// Ce fichier active la confiance dans un proxy (TRUST_PROXY=1, comme derrière Railway) AVANT de
// charger l'application, pour simuler des clients distincts par leur X-Forwarded-For. Process dédié
// (node --test), donc compteur en mémoire propre à ce fichier.
process.env.TRUST_PROXY = "1";
const { default: app } = await import("../../server/app.js");

let server: Server;
let baseUrl: string;
let societeId: number;
const identifiant = `LIMITE-CONNEXION-${randomUUID()}`;
const CODE = "code-limite-1234";

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;
  societeId = (await prisma.societe.create({ data: { nom: identifiant } })).id;
  await prisma.utilisateur.create({ data: { identifiant, codeHache: hacherCode(CODE), role: "CHEF", societeId } });
});

after(async () => {
  try {
    await prisma.utilisateur.deleteMany({ where: { societeId } });
    await prisma.societe.deleteMany({ where: { id: societeId } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

async function connexion(adresseClient: string, code: string): Promise<number> {
  const reponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": adresseClient },
    body: JSON.stringify({ identifiant, code }),
  });
  return reponse.status;
}

test("les connexions réussies ne consomment jamais la limite (12 connexions d'affilée acceptées)", async () => {
  const statuts: number[] = [];
  for (let i = 0; i < 12; i++) statuts.push(await connexion("198.51.100.1", CODE));
  assert.deepEqual(statuts, Array(12).fill(200));
});

test("10 échecs depuis une même adresse bloquent la suivante, même avec le bon code", async () => {
  const echecs: number[] = [];
  for (let i = 0; i < 10; i++) echecs.push(await connexion("198.51.100.2", "mauvais-code"));
  assert.deepEqual(echecs, Array(10).fill(401));
  assert.equal(await connexion("198.51.100.2", "mauvais-code"), 429);
  assert.equal(await connexion("198.51.100.2", CODE), 429);
});

test("le blocage d'une adresse ne touche pas les autres clients (adresse réelle derrière le proxy)", async () => {
  assert.equal(await connexion("198.51.100.2", CODE), 429, "l'adresse bloquée au test précédent le reste");
  assert.equal(await connexion("198.51.100.3", CODE), 200);
});
