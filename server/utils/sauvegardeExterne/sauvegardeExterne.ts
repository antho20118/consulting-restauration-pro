import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { KeyObject } from "node:crypto";
import { chiffrer } from "./chiffrement.js";
import { exporterBase } from "./exportBase.js";
import { EXTENSION_CHIFFREE, mensuelleDue, nomMensuelle, nomQuotidienne, PREFIXE_DOCUMENTS, PREFIXE_MENSUELLES } from "./nommage.js";
import type { StockageSauvegardes } from "./stockage.js";

// Sauvegarde hors de Railway (point 1 de l'audit du 15/10) : jusqu'ici, toutes les données ne
// vivaient que chez Railway, et l'offre Hobby n'y fait aucune sauvegarde. Une fois par nuit (voir
// planificateur.ts) :
// 1. la base entière est exportée, figée et en lecture seule (voir exportBase.ts), au format
//    restaurable par prisma/restaurer.ts ;
// 2. elle est chiffrée par la clé PUBLIQUE (voir chiffrement.ts : le serveur ne peut pas la
//    déchiffrer) et déposée chez l'hébergeur dans base/quotidiennes/ — et, si c'est la première du
//    mois, aussi dans base/mensuelles/ ;
// 3. chaque dépôt est aussitôt RELU et comparé octet pour octet (empreinte SHA-256) : une
//    sauvegarde qui ne se relit pas à l'identique n'est jamais considérée comme faite ;
// 4. les documents fournisseurs (photos de factures et de listings, sur le disque Railway et non en
//    base) absents de l'hébergeur y sont envoyés, chiffrés eux aussi, chacun une seule fois.
// Les deux étapes sont distinctes (sauvegarderBase, envoyerDocuments) : un document en échec ne fait
// jamais refaire la sauvegarde de la base (voir planificateur.ts).
// L'application ne supprime jamais rien : la conservation est assurée par les règles de cycle de
// vie de l'hébergeur (voir nommage.ts).

export class SauvegardeNonVerifieeError extends Error {}

export type BilanBase = { nom: string; tailleOctets: number; mensuelle: boolean };
export type BilanDocuments = { documentsEnvoyes: number; documentsTotal: number; documentsEchecs: string[] };
export type BilanSauvegardeExterne = BilanBase & BilanDocuments;

// Seul ce sous-dossier du disque Railway contient des documents d'origine ; "sauvegardes" (exports
// manuels de la base) n'est jamais renvoyé, la base l'étant déjà chaque nuit.
const DOSSIER_DOCUMENTS = "fournisseurs";
// Fichiers temporaires d'une écriture de document en cours (écriture atomique « .tmp » puis
// renommage, voir storageDocumentsFournisseur.ts) : jamais un document, jamais envoyés.
const EXTENSION_TEMPORAIRE = ".tmp";

function empreinte(contenu: Buffer): string {
  return createHash("sha256").update(contenu).digest("hex");
}

async function deposerEtVerifier(stockage: StockageSauvegardes, nom: string, contenu: Buffer) {
  await stockage.deposer(nom, contenu);
  let relu: Buffer;
  try {
    relu = await stockage.lire(nom);
  } catch (erreur) {
    throw new SauvegardeNonVerifieeError(`${nom} déposée mais illisible : ${(erreur as Error).message}`, { cause: erreur });
  }
  if (empreinte(relu) !== empreinte(contenu)) {
    throw new SauvegardeNonVerifieeError(`${nom} relue différente de ce qui a été déposé.`);
  }
}

async function fichiersDocuments(racine: string): Promise<string[]> {
  const dossier = path.join(racine, DOSSIER_DOCUMENTS);
  try {
    const entrees = await fs.readdir(dossier, { recursive: true, withFileTypes: true });
    return entrees
      .filter((e) => e.isFile() && !e.name.endsWith(EXTENSION_TEMPORAIRE))
      .map((e) => path.relative(racine, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw erreur;
  }
}

// Étape 1 : la base (quotidienne, plus mensuelle la première fois du mois).
export async function sauvegarderBase(params: {
  prisma: PrismaClient;
  stockage: StockageSauvegardes;
  clePublique: string | KeyObject;
  maintenant: Date;
}): Promise<BilanBase> {
  const { prisma, stockage, clePublique, maintenant } = params;
  const chiffre = chiffrer(Buffer.from(JSON.stringify(await exporterBase(prisma, maintenant))), clePublique);
  const nom = nomQuotidienne(maintenant);
  await deposerEtVerifier(stockage, nom, chiffre);
  const mensuelle = mensuelleDue((await stockage.lister(PREFIXE_MENSUELLES)).map((o) => o.nom), maintenant);
  if (mensuelle) await deposerEtVerifier(stockage, nomMensuelle(maintenant), chiffre);
  return { nom, tailleOctets: chiffre.length, mensuelle };
}

// Étape 2 : les documents absents de l'hébergeur. Un document en échec n'arrête jamais les autres :
// il est signalé (documentsEchecs) et retenté la nuit suivante ; un document disparu entre la liste
// et sa lecture (supprimé entre-temps) est simplement ignoré.
export async function envoyerDocuments(params: {
  stockage: StockageSauvegardes;
  clePublique: string | KeyObject;
  racineDocuments: string;
}): Promise<BilanDocuments> {
  const { stockage, clePublique, racineDocuments } = params;
  const locaux = await fichiersDocuments(racineDocuments);
  const deja = new Set((await stockage.lister(PREFIXE_DOCUMENTS)).map((o) => o.nom));
  let documentsEnvoyes = 0;
  const documentsEchecs: string[] = [];
  for (const relatif of locaux) {
    const nomDistant = `${PREFIXE_DOCUMENTS}${relatif}${EXTENSION_CHIFFREE}`;
    if (deja.has(nomDistant)) continue;
    let contenu: Buffer;
    try {
      contenu = await fs.readFile(path.join(racineDocuments, relatif));
    } catch (erreur) {
      if ((erreur as NodeJS.ErrnoException).code === "ENOENT") continue;
      documentsEchecs.push(`${relatif} (${(erreur as Error).message})`);
      continue;
    }
    try {
      await deposerEtVerifier(stockage, nomDistant, chiffrer(contenu, clePublique));
      documentsEnvoyes++;
    } catch (erreur) {
      documentsEchecs.push(`${relatif} (${(erreur as Error).message})`);
    }
  }
  return { documentsEnvoyes, documentsTotal: locaux.length, documentsEchecs };
}

export async function effectuerSauvegardeExterne(params: {
  prisma: PrismaClient;
  stockage: StockageSauvegardes;
  clePublique: string | KeyObject;
  racineDocuments: string | null;
  maintenant?: Date;
}): Promise<BilanSauvegardeExterne> {
  const maintenant = params.maintenant ?? new Date();
  const base = await sauvegarderBase({ ...params, maintenant });
  const documents = params.racineDocuments
    ? await envoyerDocuments({ ...params, racineDocuments: params.racineDocuments })
    : { documentsEnvoyes: 0, documentsTotal: 0, documentsEchecs: [] };
  return { ...base, ...documents };
}
