import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// Exécute le vrai script en sous-processus (comme tests/unit/authJwtSecret.test.ts) plutôt que
// d'importer main() directement : prisma/sauvegarder.ts appelle main() de façon inconditionnelle à
// l'import (pas de garde de point d'entrée, voir prisma/backfillCodeFournisseur.ts pour la même
// convention), un import direct dans ce fichier de test déclencherait donc une vraie exécution
// hors de tout contrôle.

let dossierTemporaire: string;

before(async () => {
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "sauvegarder-script-test-"));
});

after(async () => {
  await fs.rm(dossierTemporaire, { recursive: true, force: true });
});

test("npm run db:sauvegarder écrit un fichier JSON complet sur DOCUMENTS_STORAGE_PATH/sauvegardes", async () => {
  const resultat = spawnSync(process.execPath, ["--import", "tsx", "prisma/sauvegarder.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DOCUMENTS_STORAGE_PATH: dossierTemporaire },
    encoding: "utf8",
  });

  assert.equal(resultat.status, 0, `Le script a échoué : ${resultat.stderr}`);
  assert.match(resultat.stdout, /✅ Sauvegarde écrite/);

  const dossierSauvegardes = path.join(dossierTemporaire, "sauvegardes");
  const fichiers = await fs.readdir(dossierSauvegardes);
  assert.equal(fichiers.length, 1, `Un seul fichier de sauvegarde attendu, trouvé : ${fichiers.join(", ")}`);
  assert.match(fichiers[0], /^sauvegarde-.+\.json$/);

  const enveloppe = JSON.parse(await fs.readFile(path.join(dossierSauvegardes, fichiers[0]), "utf8"));

  // Format versionné (F08 de l'audit forensique, phase 2) : l'enveloppe porte formatVersion et
  // derniereMigrationAppliquee en plus des modèles — voir prisma/restaurer.ts et
  // docs/sauvegarde-restauration.md pour le raisonnement complet.
  assert.equal(enveloppe.formatVersion, 1);
  assert.equal(typeof enveloppe.creeLe, "string");
  assert.equal(typeof enveloppe.derniereMigrationAppliquee, "string");
  assert.ok(enveloppe.derniereMigrationAppliquee.length > 0);

  // Un échantillon de modèles réellement présents dans le schéma (voir prisma/schema.prisma) :
  // vérifie que l'énumération via Prisma.dmmf a bien couvert la base entière, pas seulement une
  // table isolée — chaque valeur est un tableau, jamais autre chose, même vide.
  for (const nomModele of ["Societe", "Fournisseur", "Article", "Recette", "TVA"]) {
    assert.ok(Array.isArray(enveloppe.modeles[nomModele]), `${nomModele} devrait être un tableau dans la sauvegarde`);
  }
});
