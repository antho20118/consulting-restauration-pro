import type { KeyObject } from "node:crypto";
import { lireClePublique } from "./chiffrement.js";
import type { ConfigStockageS3 } from "./stockage.js";

// Configuration de la sauvegarde hors de Railway, uniquement par variables d'environnement (jamais
// en base ni dans le dépôt) :
//   SAUVEGARDE_S3_ENDPOINT          adresse de l'hébergeur (ex. https://s3.fr-par.scw.cloud)
//   SAUVEGARDE_S3_REGION            région (ex. fr-par)
//   SAUVEGARDE_S3_BUCKET            nom de l'espace de stockage
//   SAUVEGARDE_S3_ACCESS_KEY_ID     clé d'accès — droits : déposer, lire, lister, JAMAIS supprimer
//   SAUVEGARDE_S3_SECRET_ACCESS_KEY clé secrète
//   SAUVEGARDE_CLE_PUBLIQUE         clé publique de chiffrement (voir chiffrement.ts)
//   SAUVEGARDE_S3_PREFIXE           facultatif : dossier dans l'espace (ex. « production »)
// Aucune variable : fonction désactivée (développement, tests). Configuration partielle ou
// dangereuse : signalée, jamais une sauvegarde à moitié configurée. La clé PRIVÉE ne doit jamais
// être présente sur le serveur : refusée si elle y est trouvée.

const STOCKAGE = [
  "SAUVEGARDE_S3_ENDPOINT",
  "SAUVEGARDE_S3_REGION",
  "SAUVEGARDE_S3_BUCKET",
  "SAUVEGARDE_S3_ACCESS_KEY_ID",
  "SAUVEGARDE_S3_SECRET_ACCESS_KEY",
] as const;

export type ConfigSauvegardeExterne =
  | { etat: "absente" }
  | { etat: "incomplete"; probleme: string }
  | { etat: "ok"; stockage: ConfigStockageS3; clePublique: KeyObject };

function valeurs(env: NodeJS.ProcessEnv) {
  return (nom: string) => env[nom]?.trim() ?? "";
}

// Seuls des NOMS de variables sont décrits dans un problème, jamais une valeur.
export function lireConfigStockage(env: NodeJS.ProcessEnv = process.env): ConfigStockageS3 | { probleme: string } | null {
  const valeur = valeurs(env);
  const manquantes = STOCKAGE.filter((nom) => !valeur(nom));
  if (manquantes.length === STOCKAGE.length) return null;
  if (manquantes.length > 0) return { probleme: `Variable(s) manquante(s) : ${manquantes.join(", ")}.` };
  const prefixe = valeur("SAUVEGARDE_S3_PREFIXE").replace(/^\/+|\/+$/g, "");
  return {
    endpoint: valeur("SAUVEGARDE_S3_ENDPOINT"),
    region: valeur("SAUVEGARDE_S3_REGION"),
    bucket: valeur("SAUVEGARDE_S3_BUCKET"),
    accessKeyId: valeur("SAUVEGARDE_S3_ACCESS_KEY_ID"),
    secretAccessKey: valeur("SAUVEGARDE_S3_SECRET_ACCESS_KEY"),
    prefixe: prefixe ? `${prefixe}/` : "",
  };
}

export function lireConfigSauvegardeExterne(env: NodeJS.ProcessEnv = process.env): ConfigSauvegardeExterne {
  const valeur = valeurs(env);
  if (valeur("SAUVEGARDE_CLE_PRIVEE")) {
    return {
      etat: "incomplete",
      probleme: "SAUVEGARDE_CLE_PRIVEE ne doit jamais être sur le serveur : retire-la des variables Railway et garde-la chez toi uniquement.",
    };
  }
  const stockage = lireConfigStockage(env);
  if (stockage === null && !valeur("SAUVEGARDE_CLE_PUBLIQUE")) return { etat: "absente" };
  if (stockage === null) return { etat: "incomplete", probleme: "Variables SAUVEGARDE_S3_* manquantes." };
  if ("probleme" in stockage) return { etat: "incomplete", probleme: stockage.probleme };
  if (!valeur("SAUVEGARDE_CLE_PUBLIQUE")) return { etat: "incomplete", probleme: "Variable manquante : SAUVEGARDE_CLE_PUBLIQUE." };
  try {
    return { etat: "ok", stockage, clePublique: lireClePublique(valeur("SAUVEGARDE_CLE_PUBLIQUE")) };
  } catch (erreur) {
    return { etat: "incomplete", probleme: `SAUVEGARDE_CLE_PUBLIQUE : ${(erreur as Error).message}` };
  }
}
