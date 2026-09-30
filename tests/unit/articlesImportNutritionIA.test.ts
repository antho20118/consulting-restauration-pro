import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import { connecterAdminDeTest } from "../helpers/auth.js";
import { tailleDecodeeBase64Octets } from "../../server/routes/recettes.js";

// Volet sécurité serveur de POST /api/articles/import-nutrition-ia : type MIME, taille maximale,
// structure de réponse — même mécanisme que POST /recettes/import-ia (voir
// tests/unit/recettesImportIA.test.ts), réutilisé sans modification (tailleDecodeeBase64Octets,
// avecTimeout, AnalyseTimeoutError, TAILLE_MAX_PHOTO_OCTETS importés depuis recettes.ts).
//
// Même limite documentée que recettesImportIA.test.ts : cet environnement de test n'a pas de clé
// ANTHROPIC_API_KEY configurée — impossible d'exercer ici une "analyse IA réussie". Le moteur de
// repli sans IA (analyseNutritionLocale) est testé exhaustivement dans
// tests/unit/analyseNutritionLocale.test.ts.

let server: Server;
let baseUrl: string;
let token: string;

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
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function poster(corps: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/articles/import-nutrition-ia`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(corps),
  });
}

test("POST /articles/import-nutrition-ia sans texte ni photo : 400", async () => {
  const reponse = await poster({});
  assert.equal(reponse.status, 400);
});

test("POST /articles/import-nutrition-ia avec un mauvais type MIME dans photoDataUrl : 400", async () => {
  const reponse = await poster({ photoDataUrl: "data:text/plain;base64,aGVsbG8=" });
  assert.equal(reponse.status, 400);
});

test("POST /articles/import-nutrition-ia avec une photo trop volumineuse : 400", async () => {
  // Chaîne base64 décodant à > 6 Mo (voir TAILLE_MAX_PHOTO_OCTETS, server/routes/recettes.ts).
  const donneesEnormes = "A".repeat(9_000_000);
  assert.ok(tailleDecodeeBase64Octets(donneesEnormes) > 6 * 1024 * 1024);
  const reponse = await poster({ photoDataUrl: `data:image/jpeg;base64,${donneesEnormes}` });
  assert.equal(reponse.status, 400);
});

test("POST /articles/import-nutrition-ia avec du texte valide, IA non configurée dans cet environnement : 503", async () => {
  const reponse = await poster({ texte: "Ingrédients : farine de blé, lait, oeufs. Énergie 250 kcal." });
  assert.equal(reponse.status, 503);
  const corps = await reponse.json();
  assert.match(corps.error, /ANTHROPIC_API_KEY/);
});

test("401 sans jeton d'authentification", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles/import-nutrition-ia`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texte: "test" }),
  });
  assert.equal(reponse.status, 401);
});
