// Récupération d'une sauvegarde faite hors de Railway (voir server/utils/sauvegardeExterne/) —
// depuis n'importe quel ordinateur, même si Railway est entièrement perdu. Il suffit des variables
// SAUVEGARDE_S3_* (clés de l'hébergeur de stockage) et de SAUVEGARDE_CLE_PRIVEE — la clé privée de
// chiffrement, conservée par le propriétaire hors de Railway, seule à pouvoir déchiffrer :
//
//   npm run db:recuperer-sauvegarde-externe -- liste
//   npm run db:recuperer-sauvegarde-externe -- base derniere sauvegarde.json
//   npm run db:recuperer-sauvegarde-externe -- base <nom affiché par « liste »> sauvegarde.json
//   npm run db:recuperer-sauvegarde-externe -- documents dossier-documents
//
// Le fichier « base » obtenu se restaure ensuite avec prisma/restaurer.ts, comme une sauvegarde
// manuelle (voir docs/sauvegarde-restauration.md) ; le dossier « documents » se recopie tel quel
// à la racine de DOCUMENTS_STORAGE_PATH. Jamais un fichier existant écrasé ; une récupération des
// documents interrompue reprend là où elle s'était arrêtée.

import fs from "node:fs/promises";
import path from "node:path";
import type { KeyObject } from "node:crypto";
import { dechiffrer, lireClePrivee } from "../server/utils/sauvegardeExterne/chiffrement.js";
import { lireConfigStockage } from "../server/utils/sauvegardeExterne/config.js";
import { dateSauvegardeBase, EXTENSION_CHIFFREE, PREFIXE_BASE, PREFIXE_DOCUMENTS } from "../server/utils/sauvegardeExterne/nommage.js";
import { StockageS3, type StockageSauvegardes } from "../server/utils/sauvegardeExterne/stockage.js";
import { estLanceDirectement } from "./utils/pointEntree.js";

async function existe(chemin: string): Promise<boolean> {
  try {
    await fs.access(chemin);
    return true;
  } catch {
    return false;
  }
}

// Écriture atomique (fichier « .partiel » puis renommage) : un fichier présent à son nom final est
// toujours complet — ce qui permet de reprendre une récupération interrompue sans rien réécrire.
async function ecrireSansEcraser(chemin: string, contenu: Buffer) {
  if (await existe(chemin)) throw new Error(`${chemin} existe déjà : rien n'est écrasé.`);
  await fs.mkdir(path.dirname(chemin), { recursive: true });
  const partiel = `${chemin}.partiel`;
  await fs.writeFile(partiel, contenu);
  await fs.rename(partiel, chemin);
}

export async function listerSauvegardesBase(stockage: StockageSauvegardes) {
  return (await stockage.lister(PREFIXE_BASE))
    .map((o) => ({ ...o, le: dateSauvegardeBase(o.nom) }))
    .filter((o): o is typeof o & { le: Date } => o.le !== null)
    .sort((a, b) => b.le.getTime() - a.le.getTime());
}

// Quotidiennes et mensuelles confondues, de la plus récente à la plus ancienne.
export async function recupererBase(stockage: StockageSauvegardes, clePrivee: string | KeyObject, nom: string, sortie: string): Promise<string> {
  const choisi = nom === "derniere" ? (await listerSauvegardesBase(stockage))[0]?.nom : nom;
  if (!choisi) throw new Error("Aucune sauvegarde de la base chez l'hébergeur.");
  await ecrireSansEcraser(path.resolve(sortie), dechiffrer(await stockage.lire(choisi), clePrivee));
  return choisi;
}

export async function recupererDocuments(
  stockage: StockageSauvegardes,
  clePrivee: string | KeyObject,
  dossier: string
): Promise<{ recuperes: number; dejaPresents: number; ignores: string[] }> {
  const racine = path.resolve(dossier);
  const ignores: string[] = [];
  let recuperes = 0;
  let dejaPresents = 0;
  for (const { nom } of await stockage.lister(PREFIXE_DOCUMENTS)) {
    const relatif = nom.slice(PREFIXE_DOCUMENTS.length, nom.endsWith(EXTENSION_CHIFFREE) ? -EXTENSION_CHIFFREE.length : undefined);
    const cible = path.resolve(racine, relatif);
    // Un nom venu de l'hébergeur ne sort jamais du dossier choisi.
    if (!cible.startsWith(racine + path.sep) || relatif.split("/").includes("..")) {
      ignores.push(nom);
      continue;
    }
    // Déjà récupéré lors d'un passage précédent (interrompu) : gardé tel quel, jamais réécrit.
    if (await existe(cible)) {
      dejaPresents++;
      continue;
    }
    await ecrireSansEcraser(cible, dechiffrer(await stockage.lire(nom), clePrivee));
    recuperes++;
  }
  return { recuperes, dejaPresents, ignores };
}

// Variables lues aussi depuis un fichier .env du dossier courant, comme le documente .env.example —
// celles déjà définies dans l'environnement restent prioritaires.
function chargerFichierEnv() {
  try {
    process.loadEnvFile();
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== "ENOENT") throw erreur;
  }
}

async function main() {
  chargerFichierEnv();
  const config = lireConfigStockage();
  if (config === null) throw new Error("Variables SAUVEGARDE_S3_* absentes : voir docs/sauvegarde-restauration.md.");
  if ("probleme" in config) throw new Error(config.probleme);
  const stockage = new StockageS3(config);
  const [commande, ...args] = process.argv.slice(2);
  const clePrivee = () => {
    const texte = process.env.SAUVEGARDE_CLE_PRIVEE?.trim();
    if (!texte) throw new Error("Variable SAUVEGARDE_CLE_PRIVEE absente : la clé privée conservée par le propriétaire.");
    return lireClePrivee(texte);
  };

  if (commande === "liste") {
    for (const s of await listerSauvegardesBase(stockage)) {
      console.log(`${s.le.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}  ${(s.tailleOctets / 1024).toFixed(0)} Ko  ${s.nom}`);
    }
  } else if (commande === "base" && args.length === 2) {
    const nom = await recupererBase(stockage, clePrivee(), args[0], args[1]);
    console.log(`✅ ${nom} déchiffrée dans ${path.resolve(args[1])} — à restaurer avec npm run db:restaurer.`);
  } else if (commande === "documents" && args.length === 1) {
    const { recuperes, dejaPresents, ignores } = await recupererDocuments(stockage, clePrivee(), args[0]);
    console.log(
      `✅ ${recuperes} document(s) déchiffré(s) dans ${path.resolve(args[0])}` +
        (dejaPresents > 0 ? ` (${dejaPresents} déjà présent(s), gardé(s) tel(s) quel(s)).` : ".")
    );
    if (ignores.length > 0) console.warn(`⚠️ Ignoré(s), nom suspect : ${ignores.join(", ")}`);
  } else {
    throw new Error("Usage : liste | base <derniere|nom> <fichier.json> | documents <dossier>");
  }
}

// Comme prisma/restaurer.ts : main() seulement quand le fichier est lancé directement, jamais à
// l'import depuis un test.
if (estLanceDirectement(import.meta.url)) {
  main().catch((erreur) => {
    console.error(`❌ ${(erreur as Error).message}`);
    process.exit(1);
  });
}
