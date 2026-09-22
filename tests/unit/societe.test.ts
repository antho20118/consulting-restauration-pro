import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre PUT /api/societe/:id (app Express réelle, Postgres configuré par
// DATABASE_URL) — se concentre sur coefficientMultiplicateur (voir server/routes/societe.ts et
// server/routes/consulting.ts, constat A3 de l'audit de l'agent Consulting). La valeur d'origine
// de la société (partagée avec les autres fichiers de test) est toujours restaurée en after().

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let nomOrigine: string;
let coefficientOrigine: number | null;

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
  if (!accesExistant) {
    await prisma.accesApplication.create({
      data: { identifiant: "admin", codeHache: hacherCode("1234") },
    });
  }

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: "admin", code: "1234" }),
  });
  assert.equal(reponseLogin.status, 200);
  token = (await reponseLogin.json()).token;

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  nomOrigine = societe.nom;
  coefficientOrigine = societe.coefficientMultiplicateur;
});

after(async () => {
  await prisma.societe.update({ where: { id: societeId }, data: { nom: nomOrigine, coefficientMultiplicateur: coefficientOrigine } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("accepte un coefficient multiplicateur valide et le renvoie", async () => {
  const reponse = await fetch(`${baseUrl}/api/societe/${societeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nom: "Société de test", coefficientMultiplicateur: 3.5 }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();
  assert.equal(resultat.coefficientMultiplicateur, 3.5);
});

test("accepte null : désactive la simulation sans erreur", async () => {
  const reponse = await fetch(`${baseUrl}/api/societe/${societeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nom: "Société de test", coefficientMultiplicateur: null }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();
  assert.equal(resultat.coefficientMultiplicateur, null);
});

test("refuse un coefficient <= 0 (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/societe/${societeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nom: "Société de test", coefficientMultiplicateur: 0 }),
  });
  assert.equal(reponse.status, 400);
});

test("refuse un coefficient négatif (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/societe/${societeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nom: "Société de test", coefficientMultiplicateur: -2 }),
  });
  assert.equal(reponse.status, 400);
});

// Régression trouvée en revue avant fusion de PR #66 : `coefficientMultiplicateur ?? null` dans
// l'implémentation initiale traitait "champ absent du corps de requête" exactement comme
// "coefficientMultiplicateur: null" — un simple PUT { nom } (ex. un appelant qui ne connaît pas ce
// champ) effaçait donc silencieusement un coefficient déjà configuré. Auto-contenu (ne dépend pas
// de l'ordre des tests précédents) : configure explicitement un coefficient, puis envoie un PUT
// dont le corps ne contient QUE nom, et vérifie que le coefficient survit intact.
test("un PUT ne contenant que { nom } conserve un coefficient déjà configuré (ne l'efface pas silencieusement)", async () => {
  const configuration = await fetch(`${baseUrl}/api/societe/${societeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nom: "Société de test", coefficientMultiplicateur: 4.5 }),
  });
  assert.equal(configuration.status, 200);
  assert.equal((await configuration.json()).coefficientMultiplicateur, 4.5);

  // Corps sans coefficientMultiplicateur du tout — pas même `undefined` explicite, la clé est
  // absente, exactement comme un ancien client qui ignorerait ce champ.
  const reponse = await fetch(`${baseUrl}/api/societe/${societeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nom: "Société de test (renommée)" }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();
  assert.equal(resultat.nom, "Société de test (renommée)");
  assert.equal(resultat.coefficientMultiplicateur, 4.5, "le coefficient ne doit pas avoir été effacé");

  // Vérifie aussi directement en base, pas seulement la réponse HTTP.
  const enBase = await prisma.societe.findUniqueOrThrow({ where: { id: societeId } });
  assert.equal(enBase.coefficientMultiplicateur, 4.5);
});
