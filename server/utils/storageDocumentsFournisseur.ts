// Stockage des documents fournisseurs originaux (listings/factures photographiés ou déposés) sur
// disque — jamais en base : PostgreSQL ne conserve que des métadonnées et une clé opaque (voir
// DocumentFournisseur, chantier fiche fournisseur/historique des tarifs). Ce module est la seule
// porte d'entrée/sortie vers le système de fichiers pour ces documents ; aucune route ni aucun
// appelant ne doit construire un chemin lui-même — seuls fournisseurId (déjà une FK entière connue
// de Prisma) et cle (un UUID généré ici, jamais fourni par le client) entrent dans ce module :
// aucune chaîne de type "chemin" ne traverse jamais une frontière HTTP ou base de données.
//
// Emplacement réel du volume : en production, DOCUMENTS_STORAGE_PATH DOIT pointer vers le point de
// montage d'un Railway Volume attaché au service (à créer manuellement dans le dashboard Railway —
// rien dans ce dépôt ne le fait ni ne peut vérifier qu'il existe). Sans cette variable, ce module
// refuse d'écrire en production plutôt que d'utiliser silencieusement le disque éphémère du
// conteneur (perdu à chaque redéploiement). En développement/tests, un dossier local ignoré par
// git sert de substitut.

import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";

export class DocumentInvalideError extends Error {}

const CLE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// 8 Mo décodés : la limite JSON du serveur est 10 Mo (voir server/app.ts) et le base64 gonfle la
// taille d'environ 33 % à l'encodage — cette marge évite qu'un document juste sous la limite
// décodée ne soit rejeté en amont par Express avant même d'atteindre ce module.
export const TAILLE_MAX_OCTETS = 8 * 1024 * 1024;

// Whitelist stricte, vérifiée par signature binaire réelle (jamais par le Content-Type déclaré ni
// par l'extension du fichier d'origine, l'un et l'autre librement falsifiables côté client).
const SIGNATURES: { mime: string; extension: string; correspond: (o: Buffer) => boolean }[] = [
  {
    mime: "image/jpeg",
    extension: ".jpg",
    correspond: (o) => o.length >= 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff,
  },
  {
    mime: "image/png",
    extension: ".png",
    correspond: (o) =>
      o.length >= 8 && o.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/webp",
    extension: ".webp",
    correspond: (o) =>
      o.length >= 12 && o.subarray(0, 4).toString("latin1") === "RIFF" && o.subarray(8, 12).toString("latin1") === "WEBP",
  },
  {
    mime: "application/pdf",
    extension: ".pdf",
    correspond: (o) => o.length >= 5 && o.subarray(0, 5).toString("latin1") === "%PDF-",
  },
];

function detecterSignature(octets: Buffer): { mime: string; extension: string } | null {
  const trouvee = SIGNATURES.find((s) => s.correspond(octets));
  return trouvee ? { mime: trouvee.mime, extension: trouvee.extension } : null;
}

function racineStockage(): string {
  const configuree = process.env.DOCUMENTS_STORAGE_PATH;
  if (configuree) return path.resolve(configuree);

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DOCUMENTS_STORAGE_PATH doit être défini en production (chemin de montage du Railway Volume " +
        "attaché au service) — voir la documentation de déploiement. Écriture refusée plutôt que " +
        "d'utiliser le disque éphémère du conteneur."
    );
  }

  // Développement/tests uniquement : jamais utilisé si DOCUMENTS_STORAGE_PATH est fourni, y compris
  // hors production (permet de pointer les tests vers un dossier temporaire isolé).
  return path.resolve(process.cwd(), "data-dev/documents-fournisseurs");
}

function validerFournisseurId(fournisseurId: number): void {
  if (!Number.isInteger(fournisseurId) || fournisseurId <= 0) {
    throw new DocumentInvalideError("Identifiant fournisseur invalide");
  }
}

function validerCle(cle: string): void {
  if (!CLE_REGEX.test(cle)) {
    throw new DocumentInvalideError("Référence de document invalide");
  }
}

// Défense en profondeur : même si fournisseurId/cle sont déjà validés (entier positif, UUID strict),
// vérifie que le chemin résolu reste bien sous la racine du volume avant tout accès disque.
function dossierFournisseurSecurise(racine: string, fournisseurId: number): string {
  const chemin = path.resolve(racine, "fournisseurs", String(fournisseurId));
  if (!chemin.startsWith(racine + path.sep)) {
    throw new DocumentInvalideError("Chemin de document invalide");
  }
  return chemin;
}

function parserDataUrl(dataUrl: string): Buffer {
  const correspondance = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl);
  if (!correspondance) {
    throw new DocumentInvalideError("Format de document invalide (data URL attendue)");
  }
  return Buffer.from(correspondance[1], "base64");
}

export type DocumentStocke = {
  // À conserver en base (DocumentFournisseur.cle, Phase 2) avec fournisseurId (déjà une FK
  // existante) : c'est ce couple, jamais un chemin, qui permet de retrouver le fichier ensuite.
  cle: string;
  typeMime: string;
  tailleOctets: number;
  nomFichierOriginal: string | null;
};

// Écrit le document sur le volume et retourne les métadonnées à conserver en base (Phase 2) —
// n'écrit jamais directement en base de données lui-même : séparation stricte entre le fichier
// physique (ce module) et les métadonnées PostgreSQL (routes appelantes).
export async function enregistrerDocument(params: {
  fournisseurId: number;
  dataUrl: string;
  nomFichierOriginal?: string | null;
}): Promise<DocumentStocke> {
  const { fournisseurId, dataUrl, nomFichierOriginal } = params;
  validerFournisseurId(fournisseurId);

  const octets = parserDataUrl(dataUrl);
  if (octets.length === 0) {
    throw new DocumentInvalideError("Document vide");
  }
  if (octets.length > TAILLE_MAX_OCTETS) {
    throw new DocumentInvalideError(
      `Document trop volumineux (${Math.round(octets.length / 1024 / 1024)} Mo, maximum ${TAILLE_MAX_OCTETS / 1024 / 1024} Mo)`
    );
  }

  const signature = detecterSignature(octets);
  if (!signature) {
    throw new DocumentInvalideError("Type de fichier non pris en charge (jpeg, png, webp ou pdf attendu)");
  }

  const racine = racineStockage();
  const cle = randomUUID();
  const dossier = dossierFournisseurSecurise(racine, fournisseurId);
  const cheminFinal = path.join(dossier, `${cle}${signature.extension}`);
  const cheminTemporaire = `${cheminFinal}.tmp`;

  await fs.mkdir(dossier, { recursive: true });
  try {
    // Écriture atomique (tmp puis rename) : jamais de fichier partiel visible au chemin final si le
    // processus est interrompu en cours d'écriture (disque plein, crash) — voir "comportement en cas
    // d'échec d'upload" du cadrage Phase 1.
    await fs.writeFile(cheminTemporaire, octets);
    await fs.rename(cheminTemporaire, cheminFinal);
  } catch (erreur) {
    await fs.rm(cheminTemporaire, { force: true });
    throw erreur;
  }

  return {
    cle,
    typeMime: signature.mime,
    tailleOctets: octets.length,
    nomFichierOriginal: nomFichierOriginal?.trim() || null,
  };
}

// L'extension réelle n'est pas connue de l'appelant (elle dépend du type détecté à l'écriture, pas
// du nom de fichier d'origine) : on retrouve le fichier par préfixe dans le dossier du fournisseur
// plutôt que de faire porter l'extension à la clé conservée en base.
async function trouverFichier(racine: string, fournisseurId: number, cle: string): Promise<string | null> {
  const dossier = dossierFournisseurSecurise(racine, fournisseurId);
  let entrees: string[];
  try {
    entrees = await fs.readdir(dossier);
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw erreur;
  }
  const trouvee = entrees.find((nom) => nom.startsWith(cle) && !nom.endsWith(".tmp"));
  return trouvee ? path.join(dossier, trouvee) : null;
}

export async function lireDocument(
  fournisseurId: number,
  cle: string
): Promise<{ buffer: Buffer; typeMime: string } | null> {
  validerFournisseurId(fournisseurId);
  validerCle(cle);

  const racine = racineStockage();
  const chemin = await trouverFichier(racine, fournisseurId, cle);
  if (!chemin) return null;

  let octets: Buffer;
  try {
    octets = await fs.readFile(chemin);
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw erreur;
  }

  const signature = detecterSignature(octets);
  return { buffer: octets, typeMime: signature?.mime ?? "application/octet-stream" };
}

// Idempotente : supprimer un document déjà absent n'est jamais une erreur (voir "gestion propre des
// fichiers inexistants" du cadrage Phase 1).
export async function supprimerDocument(fournisseurId: number, cle: string): Promise<void> {
  validerFournisseurId(fournisseurId);
  validerCle(cle);

  const racine = racineStockage();
  const chemin = await trouverFichier(racine, fournisseurId, cle);
  if (!chemin) return;

  await fs.rm(chemin, { force: true });
}
