import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import prisma from "../../server/prisma.js";
import { genererPaireClesSauvegarde, type PaireClesSauvegarde } from "../../src/features/parametres/utils/clesSauvegarde.js";
import { dechiffrer } from "../../server/utils/sauvegardeExterne/chiffrement.js";
import { effectuerSauvegardeExterne, SauvegardeNonVerifieeError } from "../../server/utils/sauvegardeExterne/sauvegardeExterne.js";
import type { StockageSauvegardes } from "../../server/utils/sauvegardeExterne/stockage.js";
import { lireEtValiderSauvegarde } from "../../prisma/restaurer.js";

// Sauvegarde hors de Railway (point 1 de l'audit du 15/10), chaîne complète contre la vraie base de
// test : base exportée, chiffrée par la clé PUBLIQUE (le serveur ne peut pas la relire en clair),
// déposée chez l'hébergeur puis RELUE et comparée octet pour octet avant d'être considérée comme
// faite ; copie mensuelle la première fois du mois ; documents fournisseurs envoyés une seule fois ;
// et JAMAIS une suppression : la conservation est l'affaire de l'hébergeur (voir nommage.ts).

let cles: PaireClesSauvegarde;
let dossierDocuments: string;

class StockageMemoire implements StockageSauvegardes {
  objets = new Map<string, Buffer>();
  depots: string[] = [];
  // Hébergeur qui renverrait autre chose que ce qui a été déposé (corruption, transfert tronqué).
  alterer = false;
  async deposer(nom: string, contenu: Buffer) {
    this.depots.push(nom);
    this.objets.set(nom, contenu);
  }
  async lire(nom: string) {
    const contenu = this.objets.get(nom);
    if (!contenu) throw new Error(`absent : ${nom}`);
    return this.alterer ? contenu.subarray(0, contenu.length - 1) : contenu;
  }
  async lister(prefixe: string) {
    return [...this.objets.entries()].filter(([n]) => n.startsWith(prefixe)).map(([nom, c]) => ({ nom, tailleOctets: c.length }));
  }
}

before(async () => {
  cles = await genererPaireClesSauvegarde();
  dossierDocuments = await fs.mkdtemp(path.join(os.tmpdir(), "sauvegarde-externe-test-"));
  await fs.mkdir(path.join(dossierDocuments, "fournisseurs", "12"), { recursive: true });
  await fs.writeFile(path.join(dossierDocuments, "fournisseurs", "12", "facture-a.pdf"), "%PDF-1.4 facture confidentielle");
  // Reste d'une écriture interrompue (voir enregistrerDocument) : jamais un document, jamais envoyé.
  await fs.writeFile(path.join(dossierDocuments, "fournisseurs", "12", "facture-b.pdf.tmp"), "%PDF-1.4 moiti");
  // Les sauvegardes manuelles locales (sous-dossier "sauvegardes") ne sont jamais renvoyées.
  await fs.mkdir(path.join(dossierDocuments, "sauvegardes"), { recursive: true });
  await fs.writeFile(path.join(dossierDocuments, "sauvegardes", "sauvegarde-ancienne.json"), "{}");
});

after(async () => {
  await fs.rm(dossierDocuments, { recursive: true, force: true });
  await prisma.$disconnect();
});

function sauvegarder(stockage: StockageSauvegardes, iso: string) {
  return effectuerSauvegardeExterne({
    prisma,
    stockage,
    clePublique: cles.clePublique,
    racineDocuments: dossierDocuments,
    maintenant: new Date(iso),
  });
}

test("base : chiffrée, déposée, relue ; restaurable avec la seule clé privée", async () => {
  const stockage = new StockageMemoire();
  const bilan = await sauvegarder(stockage, "2026-10-30T02:05:00Z");

  assert.equal(bilan.nom, "base/quotidiennes/sauvegarde-2026-10-30T02-05-00-000Z.json.gz.chiffre");
  const depose = stockage.objets.get(bilan.nom)!;
  assert.ok(!depose.includes(Buffer.from("derniereMigrationAppliquee")), "jamais en clair chez l'hébergeur");
  assert.throws(() => dechiffrer(depose, cles.clePublique), "la clé publique du serveur ne déchiffre pas");

  const fichier = path.join(dossierDocuments, "restauree.json");
  await fs.writeFile(fichier, dechiffrer(depose, cles.clePrivee));
  const enveloppe = await lireEtValiderSauvegarde(fichier);
  assert.equal(enveloppe.modeles.Societe.length, await prisma.societe.count());
  assert.equal(enveloppe.modeles.Recette.length, await prisma.recette.count());
  await fs.rm(fichier);
});

test("copie mensuelle : la première sauvegarde du mois seulement", async () => {
  const stockage = new StockageMemoire();
  assert.equal((await sauvegarder(stockage, "2026-10-30T02:05:00Z")).mensuelle, true, "aucune mensuelle encore");
  assert.equal((await sauvegarder(stockage, "2026-10-31T02:05:00Z")).mensuelle, false, "octobre a déjà la sienne");
  assert.equal((await sauvegarder(stockage, "2026-11-01T02:05:00Z")).mensuelle, true, "premier jour de novembre");
  const mensuelles = (await stockage.lister("base/mensuelles/")).map((o) => o.nom).sort();
  assert.deepEqual(mensuelles, [
    "base/mensuelles/sauvegarde-2026-10-30T02-05-00-000Z.json.gz.chiffre",
    "base/mensuelles/sauvegarde-2026-11-01T02-05-00-000Z.json.gz.chiffre",
  ]);
  assert.deepEqual(stockage.objets.get(mensuelles[1]), stockage.objets.get("base/quotidiennes/sauvegarde-2026-11-01T02-05-00-000Z.json.gz.chiffre"));
});

test("documents fournisseurs : chiffrés, envoyés une seule fois ; fichiers temporaires et sauvegardes locales jamais envoyés", async () => {
  const stockage = new StockageMemoire();
  const premier = await sauvegarder(stockage, "2026-10-30T02:05:00Z");
  assert.deepEqual({ envoyes: premier.documentsEnvoyes, total: premier.documentsTotal }, { envoyes: 1, total: 1 });
  const document = stockage.objets.get("documents/fournisseurs/12/facture-a.pdf.chiffre")!;
  assert.equal(dechiffrer(document, cles.clePrivee).toString(), "%PDF-1.4 facture confidentielle");
  assert.ok(![...stockage.objets.keys()].some((n) => n.includes("sauvegarde-ancienne")));
  assert.ok(![...stockage.objets.keys()].some((n) => n.includes(".tmp")), "jamais un fichier temporaire");

  stockage.depots = [];
  const second = await sauvegarder(stockage, "2026-10-31T02:05:00Z");
  assert.equal(second.documentsEnvoyes, 0);
  assert.deepEqual(stockage.depots, ["base/quotidiennes/sauvegarde-2026-10-31T02-05-00-000Z.json.gz.chiffre"], "seule la base est renvoyée");
});

test("dépôt relu différent de l'envoi : la sauvegarde n'est jamais considérée comme faite", async () => {
  const stockage = new StockageMemoire();
  stockage.alterer = true;
  await assert.rejects(sauvegarder(stockage, "2026-10-30T02:05:00Z"), SauvegardeNonVerifieeError);
});

test("jamais une suppression, même avec un long historique chez l'hébergeur", async () => {
  const stockage = new StockageMemoire() as StockageMemoire & { supprimer?: (nom: string) => Promise<void> };
  const supprimes: string[] = [];
  stockage.supprimer = async (nom) => {
    supprimes.push(nom);
  };
  for (let j = 1; j <= 60; j++) {
    const date = new Date(Date.UTC(2026, 9, 30, 2, 5) - j * 86400_000);
    stockage.objets.set(`base/quotidiennes/sauvegarde-${date.toISOString().replace(/[:.]/g, "-")}.json.gz.chiffre`, Buffer.from("ancienne"));
  }
  await sauvegarder(stockage, "2026-10-30T02:05:00Z");
  assert.deepEqual(supprimes, []);
  assert.equal((await stockage.lister("base/quotidiennes/")).length, 61);
});
