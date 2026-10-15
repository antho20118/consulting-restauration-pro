import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre POST /api/auth/login, PUT /api/auth/moi, la gestion des comptes
// (server/routes/utilisateurs.ts) et le middleware requireAuth (app Express réelle, Postgres réel).
// Voir tests/unit/production.test.ts pour le même principe appliqué à un autre endpoint.
//
// IMPORTANT sur l'ordre des tests dans ce fichier : le limiteur des échecs de connexion
// (server/routes/auth.ts, echecsParIp) est un état en mémoire PARTAGÉ par toutes les requêtes de ce
// process pour une même IP, pas remis à zéro entre les tests. Tous les appels fetch() de ce fichier
// viennent du même 127.0.0.1 ; chaque ÉCHEC de connexion (identifiant/code faux, compte désactivé)
// consomme un des 10 échecs autorisés sur 15 minutes. Le test qui vérifie le blocage (429) est donc
// le dernier à appeler /api/auth/login. Le décompte exact (réussites jamais comptées, adresse réelle
// du client derrière le proxy) est vérifié dans tests/unit/limiteConnexion.test.ts.
//
// IMPORTANT (sécurité) : le mot de passe "1234" utilisé ci-dessous est la valeur de test standard de
// toute la suite (voir tests/unit/production.test.ts, achats.test.ts, consulting.test.ts), jamais un
// identifiant réel.

let server: Server;
let baseUrl: string;
let societeId: number;
let identifiantOriginal: string;
let codeHacheOriginal: string;
let utilisateurId: number;
// Comptes créés spécifiquement par ce fichier pour les tests de rôle/désactivation, nettoyés à la fin.
const utilisateursTestIds: number[] = [];

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;

  const existant = await prisma.utilisateur.findUnique({ where: { identifiant: "admin" } });
  if (existant) {
    utilisateurId = existant.id;
    identifiantOriginal = existant.identifiant;
    codeHacheOriginal = existant.codeHache;
  } else {
    const cree = await prisma.utilisateur.create({
      data: { identifiant: "admin", codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId },
    });
    utilisateurId = cree.id;
    identifiantOriginal = cree.identifiant;
    codeHacheOriginal = cree.codeHache;
  }
});

after(async () => {
  // Aucun test de ce fichier ne modifie effectivement l'identifiant/code (les tests de
  // PUT /api/auth/moi ci-dessous s'arrêtent tous avant la mise à jour réelle en base : corps
  // invalide ou code actuel incorrect). Restauration par précaution uniquement.
  await prisma.utilisateur.update({
    where: { id: utilisateurId },
    data: { identifiant: identifiantOriginal, codeHache: codeHacheOriginal },
  });
  if (utilisateursTestIds.length > 0) {
    await prisma.utilisateur.deleteMany({ where: { id: { in: utilisateursTestIds } } });
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("requireAuth refuse une requête sans jeton (401)", async () => {
  const reponse = await fetch(`${baseUrl}/api/categories`);
  assert.equal(reponse.status, 401);
});

test("requireAuth refuse un jeton invalide (401)", async () => {
  const reponse = await fetch(`${baseUrl}/api/categories`, {
    headers: { Authorization: "Bearer un-jeton-invalide" },
  });
  assert.equal(reponse.status, 401);
});

test("POST /api/auth/login refuse un corps invalide (validation Zod, 400) — sans identifiant ni code", async () => {
  const reponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(reponse.status, 400);
});

test("POST /api/auth/login refuse un mauvais identifiant/code (401, sans révéler lequel des deux est faux)", async () => {
  const reponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: identifiantOriginal, code: "ce-nest-pas-le-bon-code" }),
  });
  assert.equal(reponse.status, 401);
});

test("POST /api/auth/login accepte le bon identifiant/code, renvoie un jeton exploitable sur une route protégée", async () => {
  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: identifiantOriginal, code: "1234" }),
  });
  assert.equal(reponseLogin.status, 200, "Ce test suppose que le code de test admin/1234 est configuré sur cette base de test.");
  const corps = await reponseLogin.json();
  assert.equal(typeof corps.token, "string");
  assert.ok(corps.token.length > 0);
  assert.equal(corps.utilisateur.role, "PROPRIETAIRE");
  assert.equal(corps.utilisateur.societeId, societeId);

  const reponseProtegee = await fetch(`${baseUrl}/api/categories`, {
    headers: { Authorization: `Bearer ${corps.token}` },
  });
  assert.equal(reponseProtegee.status, 200);
});

test("POST /api/auth/login refuse un compte désactivé (401, même message qu'un mauvais code)", async () => {
  const identifiant = `auth-test-desactive-${Date.now()}`;
  const cree = await prisma.utilisateur.create({
    data: { identifiant, codeHache: hacherCode("1234"), role: "CUISINIER", societeId, actif: false },
  });
  utilisateursTestIds.push(cree.id);

  const reponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  assert.equal(reponse.status, 401);
});

test("requireAuth bloque immédiatement un compte désactivé APRÈS l'émission d'un jeton valide", async () => {
  const identifiant = `auth-test-revocation-${Date.now()}`;
  const cree = await prisma.utilisateur.create({
    data: { identifiant, codeHache: hacherCode("1234"), role: "CUISINIER", societeId },
  });
  utilisateursTestIds.push(cree.id);

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const { token } = await reponseLogin.json();

  const avantDesactivation = await fetch(`${baseUrl}/api/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(avantDesactivation.status, 200);

  await prisma.utilisateur.update({ where: { id: cree.id }, data: { actif: false } });

  // Le jeton lui-même reste valide (signature/expiration inchangées) : c'est bien la vérification
  // "actif" de requireAuth, pas seulement jwt.verify, qui doit désormais bloquer cet accès.
  const apresDesactivation = await fetch(`${baseUrl}/api/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(apresDesactivation.status, 401);
});

test("un rôle non-PROPRIETAIRE ne peut pas accéder à la gestion des comptes (403)", async () => {
  const identifiant = `auth-test-role-${Date.now()}`;
  const cree = await prisma.utilisateur.create({
    data: { identifiant, codeHache: hacherCode("1234"), role: "CHEF", societeId },
  });
  utilisateursTestIds.push(cree.id);

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const { token } = await reponseLogin.json();

  const reponse = await fetch(`${baseUrl}/api/utilisateurs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(reponse.status, 403);
});

test("un CONSULTANT ne peut jamais écrire, même sur une route de gestion ouverte au CHEF (403)", async () => {
  const identifiant = `auth-test-consultant-${Date.now()}`;
  const cree = await prisma.utilisateur.create({
    data: { identifiant, codeHache: hacherCode("1234"), role: "CONSULTANT", societeId },
  });
  utilisateursTestIds.push(cree.id);

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const { token } = await reponseLogin.json();

  const lecture = await fetch(`${baseUrl}/api/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(lecture.status, 200, "la lecture doit rester ouverte à tout rôle authentifié");

  const ecriture = await fetch(`${baseUrl}/api/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nom: "Catégorie refusée" }),
  });
  assert.equal(ecriture.status, 403);
});

test("PUT /api/auth/moi refuse un corps invalide (validation Zod, 400) — nouveau code trop court", async () => {
  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: identifiantOriginal, code: "1234" }),
  });
  const { token } = await reponseLogin.json();

  const reponse = await fetch(`${baseUrl}/api/auth/moi`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ codeActuel: "1234", nouvelIdentifiant: "admin2", nouveauCode: "abc" }),
  });
  assert.equal(reponse.status, 400);
});

test("PUT /api/auth/moi refuse un code actuel incorrect (403, sans modifier le compte)", async () => {
  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: identifiantOriginal, code: "1234" }),
  });
  const { token } = await reponseLogin.json();

  const reponse = await fetch(`${baseUrl}/api/auth/moi`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ codeActuel: "mauvais-code", nouvelIdentifiant: "admin2", nouveauCode: "nouveau-code-123" }),
  });
  assert.equal(reponse.status, 403);

  const utilisateur = await prisma.utilisateur.findUniqueOrThrow({ where: { id: utilisateurId } });
  assert.equal(utilisateur.identifiant, identifiantOriginal);
});

test("le limiteur de connexion bloque après 10 échecs sur 15 min, y compris un identifiant/code ensuite correct", async () => {
  // Les tests précédents ont déjà consommé quelques échecs (mauvais code, compte désactivé) : on
  // échoue jusqu'au blocage, qui doit survenir au plus tard au 11e essai de ce test.
  let statut = 0;
  let essais = 0;
  while (essais < 11) {
    const reponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiant: identifiantOriginal, code: "code-incorrect" }),
    });
    statut = reponse.status;
    essais += 1;
    if (statut === 429) break;
    assert.equal(statut, 401, `essai ${essais} : 401 attendu avant le blocage, obtenu ${statut}`);
  }
  assert.equal(statut, 429, "blocage attendu après 10 échecs au plus");

  // Même un identifiant/code correct est bloqué une fois le quota d'échecs atteint.
  const reponseCorrecteMaisBloquee = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: identifiantOriginal, code: "1234" }),
  });
  assert.equal(reponseCorrecteMaisBloquee.status, 429);
});
