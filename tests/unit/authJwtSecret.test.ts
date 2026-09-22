import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// server/utils/auth.ts lit JWT_SECRET et NODE_ENV au chargement du module (throw immédiat si
// absent en production) : impossible à tester en réimportant le module dans CE process, qui tourne
// déjà avec son propre NODE_ENV (celui du test runner). Chaque cas est donc exécuté dans un
// sous-processus Node isolé, avec un environnement contrôlé.
//
// IMPORTANT (sécurité) : la valeur "valeur-de-test-jamais-un-vrai-secret" utilisée ci-dessous est un
// secret de test factice, utilisé uniquement le temps du sous-processus. Ce n'est jamais un secret
// réel ni une valeur utilisée en production.

const JWT_SECRET_TEST = "valeur-de-test-jamais-un-vrai-secret";

function importerModuleAuth(env: Record<string, string | undefined>): { code: number | null; stdout: string; stderr: string } {
  const script = `
    import("./server/utils/auth.js")
      .then((mod) => {
        const token = mod.creerToken("test");
        console.log("MODULE_CHARGE token_non_vide=" + (typeof token === "string" && token.length > 0));
        process.exit(0);
      })
      .catch((erreur) => {
        console.log("MODULE_REFUSE message=" + erreur.message);
        process.exit(0);
      });
  `;
  const resultat = spawnSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  return { code: resultat.status, stdout: resultat.stdout, stderr: resultat.stderr };
}

test("NODE_ENV=production sans JWT_SECRET : le serveur refuse de démarrer (module refusé, pas de secret par défaut)", () => {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  delete env.JWT_SECRET;

  const { stdout } = importerModuleAuth(env);

  assert.match(stdout, /MODULE_REFUSE/, `Le module aurait dû refuser de charger. Sortie : ${stdout}`);
  assert.match(stdout, /JWT_SECRET doit être défini en production/);
});

test("NODE_ENV=production avec JWT_SECRET défini : le serveur démarre normalement et peut signer un jeton", () => {
  const env = { ...process.env, NODE_ENV: "production", JWT_SECRET: JWT_SECRET_TEST };

  const { stdout } = importerModuleAuth(env);

  assert.match(stdout, /MODULE_CHARGE token_non_vide=true/, `Le module aurait dû charger normalement. Sortie : ${stdout}`);
});

test("NODE_ENV=development sans JWT_SECRET : le serveur démarre avec le secret de développement local (pas de blocage hors production)", () => {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development" };
  delete env.JWT_SECRET;

  const { stdout } = importerModuleAuth(env);

  assert.match(stdout, /MODULE_CHARGE token_non_vide=true/, `Le module aurait dû charger normalement. Sortie : ${stdout}`);
});
