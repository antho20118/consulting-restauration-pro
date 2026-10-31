import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

// Chiffrement des sauvegardes envoyées hors de Railway (voir sauvegardeExterne.ts), à DEUX clés :
// - la clé PUBLIQUE (variable SAUVEGARDE_CLE_PUBLIQUE, sur Railway) sait chiffrer, jamais
//   déchiffrer ;
// - la clé PRIVÉE, seule à pouvoir déchiffrer, reste chez le propriétaire (gestionnaire de mots de
//   passe, copie papier) et ne sert qu'à l'outil de récupération (prisma/recupererSauvegardeExterne.ts).
// Une fuite des variables Railway (incident du 21/10) ne permet donc de lire aucune sauvegarde.
// Paire de clés fabriquée dans le navigateur, voir src/features/parametres/utils/clesSauvegarde.ts.
//
// Chaque fichier : contenu compressé (gzip), chiffré par AES-256-GCM (authentifié : un fichier
// altéré ou une mauvaise clé est refusé, jamais un contenu faux restitué) avec une clé tirée au
// hasard pour CE fichier, elle-même chiffrée par la clé publique (RSA-OAEP, SHA-256).
//
// Format : "CRPSAUV2" (8 octets) | longueur de la clé chiffrée (2) | clé chiffrée | vecteur (12) |
//          étiquette GCM (16) | contenu chiffré.

const ENTETE = Buffer.from("CRPSAUV2", "latin1");
const TAILLE_VECTEUR = 12;
const TAILLE_ETIQUETTE = 16;
const BITS_MIN = 3072;
const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" };

export class CleInvalideError extends Error {}
export class DechiffrementImpossibleError extends Error {}

// Accepte la clé en base64 sur une ligne (format produit par le générateur) ou en PEM.
function enDer(texte: string): Buffer {
  return Buffer.from(texte.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
}

export function lireClePublique(texte: string): KeyObject {
  let cle: KeyObject;
  try {
    cle = createPublicKey({ key: enDer(texte), format: "der", type: "spki" });
  } catch (erreur) {
    throw new CleInvalideError("Clé publique de sauvegarde illisible (attendu : la clé PUBLIQUE produite par le générateur).", { cause: erreur });
  }
  const bits = cle.asymmetricKeyDetails?.modulusLength ?? 0;
  if (cle.asymmetricKeyType !== "rsa" || bits < BITS_MIN) {
    throw new CleInvalideError(`Clé publique de sauvegarde refusée : RSA de ${BITS_MIN} bits au moins attendue.`);
  }
  return cle;
}

export function lireClePrivee(texte: string): KeyObject {
  try {
    return createPrivateKey({ key: enDer(texte), format: "der", type: "pkcs8" });
  } catch (erreur) {
    throw new CleInvalideError("Clé privée de sauvegarde illisible.", { cause: erreur });
  }
}

export function chiffrer(contenu: Buffer, clePublique: string | KeyObject): Buffer {
  const cle = typeof clePublique === "string" ? lireClePublique(clePublique) : clePublique;
  const cleSession = randomBytes(32);
  const vecteur = randomBytes(TAILLE_VECTEUR);
  const chiffreur = createCipheriv("aes-256-gcm", cleSession, vecteur);
  const chiffre = Buffer.concat([chiffreur.update(gzipSync(contenu)), chiffreur.final()]);
  const cleSessionChiffree = publicEncrypt({ key: cle, ...OAEP }, cleSession);
  const longueur = Buffer.alloc(2);
  longueur.writeUInt16BE(cleSessionChiffree.length);
  return Buffer.concat([ENTETE, longueur, cleSessionChiffree, vecteur, chiffreur.getAuthTag(), chiffre]);
}

export function dechiffrer(fichier: Buffer, clePrivee: string | KeyObject): Buffer {
  const illisible = () => new DechiffrementImpossibleError("Déchiffrement impossible : clé privée incorrecte ou fichier altéré.");
  if (fichier.length < ENTETE.length + 2 || !fichier.subarray(0, ENTETE.length).equals(ENTETE)) {
    throw new DechiffrementImpossibleError("Ce fichier n'est pas une sauvegarde chiffrée de l'application.");
  }
  const cle = typeof clePrivee === "string" ? lireClePrivee(clePrivee) : clePrivee;
  let position = ENTETE.length;
  const longueur = fichier.readUInt16BE(position);
  position += 2;
  const debutContenu = position + longueur + TAILLE_VECTEUR + TAILLE_ETIQUETTE;
  if (fichier.length < debutContenu) throw illisible();
  let cleSession: Buffer;
  try {
    cleSession = privateDecrypt({ key: cle, ...OAEP }, fichier.subarray(position, position + longueur));
  } catch (erreur) {
    throw Object.assign(illisible(), { cause: erreur });
  }
  position += longueur;
  const vecteur = fichier.subarray(position, position + TAILLE_VECTEUR);
  const etiquette = fichier.subarray(position + TAILLE_VECTEUR, debutContenu);
  try {
    const dechiffreur = createDecipheriv("aes-256-gcm", cleSession, vecteur);
    dechiffreur.setAuthTag(etiquette);
    return gunzipSync(Buffer.concat([dechiffreur.update(fichier.subarray(debutContenu)), dechiffreur.final()]));
  } catch (erreur) {
    throw Object.assign(illisible(), { cause: erreur });
  }
}
