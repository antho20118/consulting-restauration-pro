import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";
import { avecTimeout, AnalyseTimeoutError, tailleDecodeeBase64Octets, TAILLE_MAX_PHOTO_OCTETS } from "../../server/routes/recettes.js";

// Chantier « import photo → technique » (PHASE 17), volet sécurité serveur de
// POST /api/recettes/import-ia : type MIME, taille maximale, timeout, structure de réponse,
// absence d'écriture pendant l'analyse (voir server/routes/recettes.ts et
// server/utils/importRecetteIA.ts).
//
// Limite documentée : cet environnement de test n'a pas de clé ANTHROPIC_API_KEY configurée (voir
// ImportIANonConfigureError) — il est donc impossible d'exercer ici, de façon fiable et sans
// fabriquer un mécanisme de test artificiel dans le code de production, ni une "analyse IA
// réussie" au niveau de CETTE route, ni un dépassement réel du délai de 60 s câblé sur l'appel
// réseau à l'IA. Ces deux aspects sont couverts autrement et réellement :
//   - le mécanisme de timeout lui-même (avecTimeout) est testé unitairement ci-dessous, avec un
//     délai court, indépendamment de la durée réelle câblée dans la route ;
//   - le moteur de structuration réellement utilisé quand l'IA n'est pas disponible
//     (analyseRecetteLocale) est testé exhaustivement dans tests/unit/analyseRecetteLocale.test.ts ;
//   - le chemin d'écriture d'un résultat d'analyse dans une recette existante (sans l'écraser) est
//     testé de bout en bout dans tests/unit/recettesImportTechniquePhoto.test.ts.

test("avecTimeout : résout normalement si la promesse se résout avant le délai", async () => {
  const resultat = await avecTimeout(Promise.resolve("ok"), 200);
  assert.equal(resultat, "ok");
});

test("avecTimeout : rejette avec AnalyseTimeoutError si le délai est dépassé", async () => {
  const jamaisResolue = new Promise(() => {});
  await assert.rejects(() => avecTimeout(jamaisResolue, 30), AnalyseTimeoutError);
});

test("tailleDecodeeBase64Octets : calcule la taille décodée réelle d'une chaîne base64 connue", () => {
  const original = "x".repeat(1000);
  const base64 = Buffer.from(original, "utf8").toString("base64");
  assert.equal(tailleDecodeeBase64Octets(base64), original.length);
});

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
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function poster(corps: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/recettes/import-ia`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(corps),
  });
}

// « Aucune écriture pendant l'analyse » (pour tous les tests ci-dessous) : garanti structurellement
// par lecture directe de POST /recettes/import-ia (server/routes/recettes.ts) — cette route ne
// contient aucun appel Prisma d'écriture (create/update/delete), uniquement des lectures de
// référence (unités/catégories) puis l'appel à extraireRecette ; jamais un enregistrement de
// recette. Volontairement PAS vérifié ici par un comptage global avant/après (ex.
// `prisma.recette.count()`) : un tel comptage serait exposé à la concurrence des autres fichiers de
// test exécutés en parallèle par `node --test` (une recette créée par un AUTRE fichier pendant la
// fenêtre du test ferait échouer celui-ci sans rapport avec le code testé ici — voir l'audit du
// chantier P2003/P2025, qui a caractérisé précisément ce risque) — et cette route ne prend de toute
// façon aucun paramètre permettant de cibler un enregistrement précis qu'on pourrait vérifier
// l'absence de façon scopée.

test("POST /recettes/import-ia sans texte ni photo : 400", async () => {
  const reponse = await poster({});
  assert.equal(reponse.status, 400);
});

test("POST /recettes/import-ia avec un mauvais type MIME dans photoDataUrl : 400, message exploitable", async () => {
  const reponse = await poster({ photoDataUrl: "data:text/plain;base64,aGVsbG8=" });
  assert.equal(reponse.status, 400);
  const corps = await reponse.json();
  assert.ok(corps.error);
});

test("POST /recettes/import-ia avec une photoDataUrl malformée (pas de data URL image) : 400", async () => {
  const reponse = await poster({ photoDataUrl: "ceci-nest-pas-une-data-url" });
  assert.equal(reponse.status, 400);
});

test("POST /recettes/import-ia avec une photo trop volumineuse : 400, message exploitable", async () => {
  // Construit une chaîne base64 dont la taille décodée dépasse strictement la limite (8 Mo),
  // sans dépendre d'un vrai fichier image : seule la taille décodée du contenu base64 compte pour
  // cette vérification (voir tailleDecodeeBase64Octets), pas le fait que ce soit une image valide.
  const octetsExcedentaires = TAILLE_MAX_PHOTO_OCTETS + 1024;
  const donneesBase64 = Buffer.alloc(octetsExcedentaires, 1).toString("base64");
  const reponse = await poster({ photoDataUrl: `data:image/png;base64,${donneesBase64}` });
  assert.equal(reponse.status, 400);
  const corps = await reponse.json();
  assert.match(corps.error, /volumineuse/i);
});

test("POST /recettes/import-ia avec du texte valide, IA non configurée dans cet environnement : 503, message exploitable", async () => {
  const reponse = await poster({ texte: "Sauté de veau\n1. Faire revenir la viande" });
  assert.equal(reponse.status, 503);
  const corps = await reponse.json();
  assert.ok(corps.error);
});

test("POST /recettes/import-ia avec une photo de taille acceptable mais IA non configurée : 503 (jamais 400 taille, jamais 500)", async () => {
  const donneesBase64 = Buffer.alloc(1024, 1).toString("base64");
  const reponse = await poster({ photoDataUrl: `data:image/png;base64,${donneesBase64}` });
  assert.equal(reponse.status, 503);
});
