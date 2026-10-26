import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { creerToken, hacherCode } from "../../server/utils/auth.js";

// Session de 12 h (jeton JWT) : un cuisinier connecté le matin était déconnecté d'office 12 h plus
// tard, en plein service, quel que soit son usage de l'application ; et un rôle changé par le
// PROPRIETAIRE (CUISINIER -> CHEF, ou l'inverse) n'apparaissait dans ses menus qu'après une
// reconnexion — le serveur appliquant déjà le nouveau rôle, l'interface affichait des écrans refusés
// ou en masquait d'autres. GET /api/auth/session renouvelle le jeton d'une session active (dans la
// limite d'une durée totale de session) et renvoie le compte tel qu'il est en base.

let server: Server;
let baseUrl: string;
let societeId: number;
let utilisateurId: number;
const marqueur = `SESSION-${randomUUID()}`;
const identifiant = `${marqueur}-cuisinier`;

type Decode = { id: number; role: string; iat: number; exp: number; connecteLe?: number };
const decoder = (jeton: string) => jwt.decode(jeton) as Decode;
const maintenant = () => Math.floor(Date.now() / 1000);

function session(jeton: string) {
  return fetch(`${baseUrl}/api/auth/session`, { headers: { Authorization: `Bearer ${jeton}` } });
}

function jetonDuCompte(connecteLe?: number): string {
  return creerToken({ id: utilisateurId, identifiant, role: "CUISINIER", societeId }, connecteLe === undefined ? undefined : { connecteLe });
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

  societeId = (await prisma.societe.create({ data: { nom: marqueur } })).id;
  utilisateurId = (
    await prisma.utilisateur.create({ data: { identifiant, codeHache: hacherCode("1234"), role: "CUISINIER", societeId } })
  ).id;
});

after(async () => {
  try {
    await prisma.utilisateur.deleteMany({ where: { societeId } });
    await prisma.societe.deleteMany({ where: { id: societeId } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

test("session active : jeton renouvelé pour 12 h, début de session conservé", async () => {
  const debut = maintenant() - 11 * 3600;
  const reponse = await session(jetonDuCompte(debut));
  assert.equal(reponse.status, 200, await reponse.clone().text());
  const { token } = (await reponse.json()) as { token: string };
  const renouvele = decoder(token);
  assert.equal(renouvele.id, utilisateurId);
  assert.equal(renouvele.connecteLe, debut, "la durée totale de session reste comptée depuis la connexion");
  assert.ok(renouvele.exp - maintenant() > 11.9 * 3600, `expire dans ${renouvele.exp - maintenant()} s`);
});

test("rôle changé en base : renvoyé tel quel, pour que l'interface l'applique sans reconnexion", async () => {
  await prisma.utilisateur.update({ where: { id: utilisateurId }, data: { role: "CHEF" } });
  try {
    const reponse = await session(jetonDuCompte());
    const corps = (await reponse.json()) as { token: string; utilisateur: { id: number; role: string; societeId: number; superAdmin: boolean } };
    assert.deepEqual(
      { ...corps.utilisateur },
      { id: utilisateurId, identifiant, role: "CHEF", societeId, superAdmin: false }
    );
    assert.equal(decoder(corps.token).role, "CHEF");
  } finally {
    await prisma.utilisateur.update({ where: { id: utilisateurId }, data: { role: "CUISINIER" } });
  }
});

test("jeton émis avant ce changement (sans début de session) : la session débute à son émission", async () => {
  // Émis il y a une heure (iat fourni à jsonwebtoken), pour distinguer son émission de l'instant présent.
  const emisIlYaUneHeure = maintenant() - 3600;
  const ancien = creerToken({ id: utilisateurId, identifiant, role: "CUISINIER", societeId, iat: emisIlYaUneHeure } as Parameters<typeof creerToken>[0]);
  const iat = decoder(ancien).iat;
  assert.equal(iat, emisIlYaUneHeure);
  const { token } = (await (await session(ancien)).json()) as { token: string };
  assert.equal(decoder(token).connecteLe, iat);
});

test("au-delà de 7 jours depuis la connexion : plus de renouvellement, reconnexion demandée", async () => {
  const reponse = await session(jetonDuCompte(maintenant() - 7 * 24 * 3600 - 60));
  assert.equal(reponse.status, 401);
  const juste = await session(jetonDuCompte(maintenant() - 7 * 24 * 3600 + 3600));
  assert.equal(juste.status, 200, "témoin : un peu moins de 7 jours, renouvelé");
});

test("compte désactivé ou jeton absent : jamais renouvelé", async () => {
  assert.equal((await fetch(`${baseUrl}/api/auth/session`)).status, 401);
  await prisma.utilisateur.update({ where: { id: utilisateurId }, data: { actif: false } });
  try {
    assert.equal((await session(jetonDuCompte())).status, 401);
  } finally {
    await prisma.utilisateur.update({ where: { id: utilisateurId }, data: { actif: true } });
  }
});
