import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Scripts de restauration et de récupération lancés depuis un dossier dont le nom contient des
// espaces ou des accents (cas réel : « Projet application consulting » sur le Mac du propriétaire) :
// ils ne faisaient RIEN, sans message, avec un code de sortie 0 — en pleine urgence, une restauration
// silencieusement jamais faite. Voir prisma/utils/pointEntree.ts.

let lien: string;

before(async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "point-entree-"));
  lien = path.join(parent, "Projet dépôt consulting");
  await fs.symlink(process.cwd(), lien);
});

after(async () => {
  await fs.rm(path.dirname(lien), { recursive: true, force: true });
});

function lancer(script: string, args: string[]) {
  const env = { ...process.env };
  for (const nom of Object.keys(env)) if (nom.startsWith("SAUVEGARDE_")) delete env[nom];
  return spawnSync(process.execPath, ["--import", "tsx", path.join(lien, script), ...args], { cwd: lien, env, encoding: "utf8" });
}

test("restaurer.ts depuis un chemin avec espaces et accents : s'exécute (usage affiché, code d'erreur)", () => {
  const resultat = lancer("prisma/restaurer.ts", []);
  assert.notEqual(resultat.status, 0, "jamais un succès silencieux");
  assert.match(resultat.stderr, /Usage/);
});

test("recupererSauvegardeExterne.ts depuis un chemin avec espaces et accents : s'exécute (configuration absente signalée)", () => {
  const resultat = lancer("prisma/recupererSauvegardeExterne.ts", ["liste"]);
  assert.notEqual(resultat.status, 0, "jamais un succès silencieux");
  assert.match(resultat.stderr, /SAUVEGARDE_S3_\* absentes/);
});
