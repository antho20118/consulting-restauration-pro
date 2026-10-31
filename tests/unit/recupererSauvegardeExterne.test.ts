import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chiffrer } from "../../server/utils/sauvegardeExterne/chiffrement.js";
import { genererPaireClesSauvegarde, type PaireClesSauvegarde } from "../../src/features/parametres/utils/clesSauvegarde.js";
import type { StockageSauvegardes } from "../../server/utils/sauvegardeExterne/stockage.js";
import { recupererBase, recupererDocuments } from "../../prisma/recupererSauvegardeExterne.js";
import { spawnSync } from "node:child_process";

// Récupération d'une sauvegarde faite hors de Railway (voir prisma/recupererSauvegardeExterne.ts) :
// la base, déchiffrée avec la clé privée du propriétaire, prête pour prisma/restaurer.ts ; les documents fournisseurs, déchiffrés et
// rangés comme sur le disque d'origine. Jamais un fichier existant écrasé, jamais un nom venu de
// l'hébergeur qui sortirait du dossier choisi.

let cles: PaireClesSauvegarde;
let dossier: string;

function stockageAvec(objets: Record<string, Buffer>): StockageSauvegardes {
  const m = new Map(Object.entries(objets));
  return {
    async deposer() {},
    async lire(nom) {
      return m.get(nom)!;
    },
    async lister(prefixe) {
      return [...m.entries()].filter(([n]) => n.startsWith(prefixe)).map(([nom, c]) => ({ nom, tailleOctets: c.length }));
    },
  };
}

before(async () => {
  cles = await genererPaireClesSauvegarde();
  dossier = await fs.mkdtemp(path.join(os.tmpdir(), "recuperer-sauvegarde-test-"));
});
after(async () => {
  await fs.rm(dossier, { recursive: true, force: true });
});

test("base : la plus récente (quotidienne ou mensuelle) ou celle demandée, déchiffrée ; jamais un fichier écrasé", async () => {
  const stockage = stockageAvec({
    "base/mensuelles/sauvegarde-2026-09-01T02-05-00-000Z.json.gz.chiffre": chiffrer(Buffer.from('{"jour":1}'), cles.clePublique),
    "base/quotidiennes/sauvegarde-2026-10-29T02-05-00-000Z.json.gz.chiffre": chiffrer(Buffer.from('{"jour":29}'), cles.clePublique),
    "base/quotidiennes/sauvegarde-2026-10-30T02-05-00-000Z.json.gz.chiffre": chiffrer(Buffer.from('{"jour":30}'), cles.clePublique),
  });
  const sortie = path.join(dossier, "derniere.json");
  assert.equal(
    await recupererBase(stockage, cles.clePrivee, "derniere", sortie),
    "base/quotidiennes/sauvegarde-2026-10-30T02-05-00-000Z.json.gz.chiffre"
  );
  assert.equal(await fs.readFile(sortie, "utf8"), '{"jour":30}');

  const choisie = path.join(dossier, "choisie.json");
  await recupererBase(stockage, cles.clePrivee, "base/mensuelles/sauvegarde-2026-09-01T02-05-00-000Z.json.gz.chiffre", choisie);
  assert.equal(await fs.readFile(choisie, "utf8"), '{"jour":1}');

  await assert.rejects(recupererBase(stockage, cles.clePrivee, "derniere", sortie), /existe déjà/);
  assert.equal(await fs.readFile(sortie, "utf8"), '{"jour":30}');
});

test("documents : déchiffrés et rangés comme à l'origine ; nom suspect refusé", async () => {
  const stockage = stockageAvec({
    "documents/fournisseurs/12/facture-a.pdf.chiffre": chiffrer(Buffer.from("%PDF facture"), cles.clePublique),
    "documents/fournisseurs/12/../../../evasion.txt.chiffre": chiffrer(Buffer.from("non"), cles.clePublique),
  });
  const cible = path.join(dossier, "documents");
  const bilan = await recupererDocuments(stockage, cles.clePrivee, cible);
  assert.deepEqual(bilan, { recuperes: 1, dejaPresents: 0, ignores: ["documents/fournisseurs/12/../../../evasion.txt.chiffre"] });
  assert.equal(await fs.readFile(path.join(cible, "fournisseurs", "12", "facture-a.pdf"), "utf8"), "%PDF facture");
  await assert.rejects(fs.access(path.join(dossier, "evasion.txt")));

  // Récupération interrompue puis relancée sur le même dossier : reprend sans erreur ni réécriture.
  const reprise = await recupererDocuments(stockage, cles.clePrivee, cible);
  assert.deepEqual(reprise, { recuperes: 0, dejaPresents: 1, ignores: ["documents/fournisseurs/12/../../../evasion.txt.chiffre"] });
});

test("outil lancé avec un fichier .env (comme le documente .env.example) : variables lues", async () => {
  const dossierEnv = await fs.mkdtemp(path.join(os.tmpdir(), "recuperer-env-"));
  // Configuration volontairement incomplète : le message prouve que le fichier a été lu.
  await fs.writeFile(path.join(dossierEnv, ".env"), "SAUVEGARDE_S3_ENDPOINT=https://s3.exemple.test\nSAUVEGARDE_S3_REGION=fr-par\n");
  const env = { ...process.env };
  for (const nom of Object.keys(env)) if (nom.startsWith("SAUVEGARDE_")) delete env[nom];
  const resultat = spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), path.resolve("prisma/recupererSauvegardeExterne.ts"), "liste"],
    { cwd: dossierEnv, env, encoding: "utf8" }
  );
  await fs.rm(dossierEnv, { recursive: true, force: true });
  assert.notEqual(resultat.status, 0);
  assert.match(resultat.stderr, /Variable\(s\) manquante\(s\) : SAUVEGARDE_S3_BUCKET/);
});
