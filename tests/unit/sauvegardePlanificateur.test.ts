import { after, before, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import prisma from "../../server/prisma.js";
import { PlanificateurSauvegardeExterne } from "../../server/utils/sauvegardeExterne/planificateur.js";
import { lireConfigSauvegardeExterne } from "../../server/utils/sauvegardeExterne/config.js";
import type { StockageSauvegardes } from "../../server/utils/sauvegardeExterne/stockage.js";
import { genererPaireClesSauvegarde } from "../../src/features/parametres/utils/clesSauvegarde.js";

// Déclenchement de la sauvegarde hors de Railway, dans le serveur (voir planificateur.ts) : une par
// nuit, jamais de doublon ni d'oubli après un redémarrage, échec inscrit au journal des erreurs et
// retenté une heure plus tard (jamais en boucle), configuration incomplète ou dangereuse (clé
// privée présente sur le serveur) signalée sans jamais révéler une valeur secrète.

const cles = await genererPaireClesSauvegarde();
const ENV = {
  SAUVEGARDE_S3_ENDPOINT: "https://s3.exemple.test",
  SAUVEGARDE_S3_REGION: "fr-par",
  SAUVEGARDE_S3_BUCKET: "mes-sauvegardes",
  SAUVEGARDE_S3_ACCESS_KEY_ID: "CLE",
  SAUVEGARDE_S3_SECRET_ACCESS_KEY: "secret-tres-confidentiel",
  SAUVEGARDE_CLE_PUBLIQUE: cles.clePublique,
};

class StockageMemoire implements StockageSauvegardes {
  objets = new Map<string, Buffer>();
  enPanne = false;
  // Seuls les documents sont refusés (la base passe) : panne partielle.
  documentsEnPanne = false;
  depotsBase = 0;
  async deposer(nom: string, contenu: Buffer) {
    if (this.enPanne) throw new Error("Hébergeur injoignable (test)");
    if (this.documentsEnPanne && nom.startsWith("documents/")) throw new Error("Document refusé (test)");
    if (nom.startsWith("base/quotidiennes/")) this.depotsBase++;
    this.objets.set(nom, contenu);
  }
  async lire(nom: string) {
    return this.objets.get(nom)!;
  }
  async lister(prefixe: string) {
    return [...this.objets.entries()].filter(([n]) => n.startsWith(prefixe)).map(([nom, c]) => ({ nom, tailleOctets: c.length }));
  }
}

function planificateur(stockage: StockageSauvegardes, horloge: { t: Date }, racineDocuments: () => string | null = () => null) {
  return new PlanificateurSauvegardeExterne({ prisma, env: ENV, stockage, maintenant: () => horloge.t, racineDocuments });
}

let dossierDocuments: string;
before(async () => {
  dossierDocuments = await fs.mkdtemp(path.join(os.tmpdir(), "planificateur-documents-"));
  await fs.mkdir(path.join(dossierDocuments, "fournisseurs", "3"), { recursive: true });
  await fs.writeFile(path.join(dossierDocuments, "fournisseurs", "3", "facture.pdf"), "%PDF test");
});

after(async () => {
  await fs.rm(dossierDocuments, { recursive: true, force: true });
  await prisma.journalErreur.deleteMany({ where: { route: "sauvegarde-externe", message: { contains: "(test)" } } });
  await prisma.$disconnect();
});

test("une par nuit à partir de 3 h (Paris), jamais de doublon, même après un redémarrage", async () => {
  const stockage = new StockageMemoire();
  const horloge = { t: new Date("2026-10-30T01:00:00Z") }; // 2 h à Paris
  const p = planificateur(stockage, horloge);

  await p.tour();
  assert.equal(stockage.depotsBase, 1, "aucune sauvegarde encore : faite tout de suite");
  horloge.t = new Date("2026-10-30T15:00:00Z");
  await p.tour();
  assert.equal(stockage.depotsBase, 1, "déjà faite aujourd'hui");
  assert.equal(p.etat().derniereReussie?.le, "2026-10-30T01:00:00.000Z");

  // Redémarrage du serveur le lendemain à 2 h (Paris) : relit la dernière chez l'hébergeur.
  horloge.t = new Date("2026-10-31T01:00:00Z");
  const apresRedemarrage = planificateur(stockage, horloge);
  await apresRedemarrage.tour();
  assert.equal(stockage.depotsBase, 1, "2 h : pas encore");
  horloge.t = new Date("2026-10-31T02:10:00Z");
  await apresRedemarrage.tour();
  assert.equal(stockage.depotsBase, 2, "3 h 10 : sauvegarde de la nuit");
});

test("échec : inscrit au journal des erreurs, retenté une heure plus tard, pas avant", async () => {
  const stockage = new StockageMemoire();
  stockage.enPanne = true;
  const horloge = { t: new Date("2026-11-02T02:10:00Z") };
  const p = planificateur(stockage, horloge);

  await p.tour();
  assert.equal(p.etat().dernierEchec?.message, "Hébergeur injoignable (test)");
  assert.equal(await prisma.journalErreur.count({ where: { route: "sauvegarde-externe", message: { contains: "injoignable (test)" } } }), 1);

  stockage.enPanne = false;
  horloge.t = new Date("2026-11-02T02:40:00Z");
  await p.tour();
  assert.equal(stockage.depotsBase, 0, "30 minutes après l'échec : pas encore");
  horloge.t = new Date("2026-11-02T03:15:00Z");
  await p.tour();
  assert.equal(stockage.depotsBase, 1, "une heure après : retentée et réussie");
  assert.equal(p.etat().dernierEchec, null);
});

test("configuration : absente -> désactivée ; incomplète -> signalée sans jamais révéler une valeur", () => {
  assert.equal(lireConfigSauvegardeExterne({}).etat, "absente");
  const incomplete = lireConfigSauvegardeExterne({ ...ENV, SAUVEGARDE_S3_BUCKET: "" });
  assert.equal(incomplete.etat, "incomplete");
  assert.match(incomplete.etat === "incomplete" ? incomplete.probleme : "", /SAUVEGARDE_S3_BUCKET/);
  const cleIllisible = lireConfigSauvegardeExterne({ ...ENV, SAUVEGARDE_CLE_PUBLIQUE: "pas-une-cle" });
  assert.equal(cleIllisible.etat, "incomplete");
  assert.doesNotMatch(JSON.stringify(cleIllisible), /pas-une-cle|secret-tres-confidentiel/);
  assert.equal(lireConfigSauvegardeExterne({ ...ENV, SAUVEGARDE_CLE_PUBLIQUE: "" }).etat, "incomplete");
  // La clé privée n'a rien à faire sur le serveur : refusée, sans jamais la répéter.
  const avecPrivee = lireConfigSauvegardeExterne({ ...ENV, SAUVEGARDE_CLE_PRIVEE: cles.clePrivee });
  assert.equal(avecPrivee.etat, "incomplete");
  assert.match(avecPrivee.etat === "incomplete" ? avecPrivee.probleme : "", /SAUVEGARDE_CLE_PRIVEE/);
  assert.ok(!JSON.stringify(avecPrivee).includes(cles.clePrivee.slice(0, 40)));
  const ok = lireConfigSauvegardeExterne({ ...ENV, SAUVEGARDE_S3_PREFIXE: "/production/" });
  assert.equal(ok.etat === "ok" ? ok.stockage.prefixe : null, "production/");

  const p = new PlanificateurSauvegardeExterne({ prisma, env: {}, stockage: new StockageMemoire() });
  assert.equal(p.etat().configuration, "absente");
});

test("documents en échec après la base : la nuit compte comme faite, la base n'est jamais refaite toutes les heures", async () => {
  const stockage = new StockageMemoire();
  stockage.documentsEnPanne = true;
  const horloge = { t: new Date("2026-11-03T02:10:00Z") };
  const p = planificateur(stockage, horloge, () => dossierDocuments);

  await p.tour();
  assert.equal(stockage.depotsBase, 1);
  assert.equal(p.etat().derniereReussie?.le, "2026-11-03T02:10:00.000Z", "la base est bien sauvegardée");
  assert.match(p.etat().dernierEchec?.message ?? "", /Base sauvegardée, mais documents fournisseurs en échec.*Document refusé \(test\)/);

  for (const heure of ["2026-11-03T03:20:00Z", "2026-11-03T05:00:00Z", "2026-11-03T12:00:00Z"]) {
    horloge.t = new Date(heure);
    await p.tour();
  }
  assert.equal(stockage.depotsBase, 1, "jamais une nouvelle sauvegarde complète de la base le même jour");

  // La nuit suivante, documents de nouveau acceptés : envoyés, échec effacé.
  stockage.documentsEnPanne = false;
  horloge.t = new Date("2026-11-04T02:10:00Z");
  await p.tour();
  assert.equal(stockage.depotsBase, 2);
  assert.ok(stockage.objets.has("documents/fournisseurs/3/facture.pdf.chiffre"));
  assert.equal(p.etat().dernierEchec, null);
});

test("dossier des documents introuvable (DOCUMENTS_STORAGE_PATH absent en production) : signalé, jamais ignoré en silence", async () => {
  const stockage = new StockageMemoire();
  const p = planificateur(stockage, { t: new Date("2026-11-05T02:10:00Z") }, () => {
    throw new Error("DOCUMENTS_STORAGE_PATH doit être défini en production (test)");
  });
  await p.tour();
  assert.equal(stockage.depotsBase, 1, "la base est sauvegardée quand même");
  assert.match(p.etat().dernierEchec?.message ?? "", /documents fournisseurs en échec.*DOCUMENTS_STORAGE_PATH/);
});

test("juste après un démarrage : dernière sauvegarde inconnue, jamais présentée comme absente", async () => {
  const stockage = new StockageMemoire();
  stockage.objets.set("base/quotidiennes/sauvegarde-2026-11-05T02-10-00-000Z.json.gz.chiffre", Buffer.from("x"));
  const p = planificateur(stockage, { t: new Date("2026-11-05T15:00:00Z") });
  assert.equal(p.etat().derniereConnue, false);
  await p.tour();
  assert.equal(p.etat().derniereConnue, true);
  assert.equal(p.etat().derniereReussie?.le, "2026-11-05T02:10:00.000Z");
});
