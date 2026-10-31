import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Ce fichier est-il le script lancé directement (`npx tsx prisma/xxx.ts`) et non importé par un test ?
// Équivalent ESM de `require.main === module`. Comparaison des chemins RÉELS sur le disque, jamais
// des adresses textuelles : `import.meta.url` encode les espaces et les accents (%20, %C3%A9…) alors
// que process.argv[1] ne les encode pas — depuis un dossier comme « Projet application consulting »,
// les scripts de sauvegarde et de restauration ne faisaient alors RIEN, sans erreur et avec un code
// de sortie 0. Les liens symboliques sont résolus des deux côtés pour la même raison.
export function estLanceDirectement(importMetaUrl: string): boolean {
  const lance = process.argv[1];
  if (!lance) return false;
  try {
    return fs.realpathSync(fileURLToPath(importMetaUrl)) === fs.realpathSync(path.resolve(lance));
  } catch {
    return false;
  }
}
