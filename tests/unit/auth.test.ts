import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre POST /api/auth/login, PUT /api/auth/identifiants et le middleware
// requireAuth (app Express réelle, Postgres réel). Voir tests/unit/production.test.ts pour le même
// principe appliqué à un autre endpoint.
//
// IMPORTANT sur l'ordre des tests dans ce fichier : le limiteur de tentatives de connexion
// (server/routes/auth.ts, tentativesParIp) est un état en mémoire PARTAGÉ par toutes les requêtes de
// ce process pour une même IP, pas remis à zéro entre les tests. Comme tous les appels fetch() de ce
// fichier viennent du même 127.0.0.1, chaque appel à /api/auth/login (qu'il réussisse ou échoue)
// consomme une des 10 tentatives autorisées sur 15 minutes. Les tests sont donc volontairement
// ordonnés pour que celui qui vérifie le blocage (429) soit le dernier à utiliser cet identifiant,
// et budgétisent explicitement le nombre d'appels de connexion utilisés avant lui.
//
// IMPORTANT (sécurité) : le mot de passe "1234" utilisé ci-dessous est la valeur de test standard de
// toute la suite (voir tests/unit/production.test.ts, achats.test.ts, consulting.test.ts), jamais un
// identifiant réel.

let server: Server;
let baseUrl: string;
let identifiantOriginal: string;
let codeHacheOriginal: string;
let accesId: number;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  const accesExistant = await prisma.accesApplication.findFirst();
  if (accesExistant) {
    accesId = accesExistant.id;
    identifiantOriginal = accesExistant.identifiant;
    codeHacheOriginal = accesExistant.codeHache;
  } else {
    const cree = await prisma.accesApplication.create({
      data: { identifiant: "admin", codeHache: hacherCode("1234") },
    });
    accesId = cree.id;
    identifiantOriginal = cree.identifiant;
    codeHacheOriginal = cree.codeHache;
  }
});

after(async () => {
  // Aucun test de ce fichier ne modifie effectivement l'identifiant/code (les tests de
  // PUT /api/auth/identifiants ci-dessous s'arrêtent tous avant la mise à jour réelle en base :
  // corps invalide ou code actuel incorrect). Restauration par précaution uniquement.
  await prisma.accesApplication.update({
    where: { id: accesId },
    data: { identifiant: identifiantOriginal, codeHache: codeHacheOriginal },
  });
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
  const { token } = await reponseLogin.json();
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0);

  const reponseProtegee = await fetch(`${baseUrl}/api/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(reponseProtegee.status, 200);
});

test("PUT /api/auth/identifiants refuse un corps invalide (validation Zod, 400) — nouveau code trop court", async () => {
  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: identifiantOriginal, code: "1234" }),
  });
  const { token } = await reponseLogin.json();

  const reponse = await fetch(`${baseUrl}/api/auth/identifiants`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ codeActuel: "1234", nouvelIdentifiant: "admin2", nouveauCode: "abc" }),
  });
  assert.equal(reponse.status, 400);
});

test("PUT /api/auth/identifiants refuse un code actuel incorrect (403, sans modifier les identifiants)", async () => {
  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: identifiantOriginal, code: "1234" }),
  });
  const { token } = await reponseLogin.json();

  const reponse = await fetch(`${baseUrl}/api/auth/identifiants`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ codeActuel: "mauvais-code", nouvelIdentifiant: "admin2", nouveauCode: "nouveau-code-123" }),
  });
  assert.equal(reponse.status, 403);

  const acces = await prisma.accesApplication.findUniqueOrThrow({ where: { id: accesId } });
  assert.equal(acces.identifiant, identifiantOriginal);
});

test("le limiteur de connexion bloque après 10 tentatives sur 15 min, y compris un identifiant/code ensuite correct", async () => {
  // Budget consommé par les tests précédents de ce fichier sur POST /api/auth/login : 5 — les 3
  // tests dédiés à /login (corps invalide, mauvais code, bon code) plus 1 appel caché dans chacun
  // des 2 tests PUT /api/auth/identifiants (qui doivent d'abord se connecter pour obtenir un jeton).
  // Il reste donc 5 tentatives autorisées avant blocage (10 au total). On les consomme ici avec des
  // tentatives volontairement incorrectes, puis on vérifie que la 11e (quel que soit son contenu)
  // est bloquée.
  for (let i = 0; i < 5; i++) {
    const reponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiant: identifiantOriginal, code: "code-incorrect" }),
    });
    assert.equal(
      reponse.status,
      401,
      `Tentative ${i + 1}/5 : attendu 401 (pas encore bloqué), obtenu ${reponse.status}. Le budget de tentatives suppose qu'aucun autre test de ce fichier n'appelle /api/auth/login.`
    );
  }

  const reponseBloquee = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: identifiantOriginal, code: "code-incorrect" }),
  });
  assert.equal(reponseBloquee.status, 429);

  // Même un identifiant/code correct est bloqué une fois le quota atteint : le limiteur ne
  // distingue pas les tentatives valides des invalides une fois déclenché (compromis UX assumé pour
  // un identifiant/code partagé par toute une équipe — voir le rapport d'audit).
  const reponseCorrecteMaisBloquee = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: identifiantOriginal, code: "1234" }),
  });
  assert.equal(reponseCorrecteMaisBloquee.status, 429);
});
