// Copie les fichiers binaires de Tesseract.js (worker, moteur wasm, données de langue française)
// depuis node_modules vers public/tesseract/, pour que l'OCR local (voir
// src/features/recettes/utils/ocrPhoto.ts) fonctionne sans dépendre d'un CDN externe au premier
// essai (https://cdn.jsdelivr.net, https://tessdata.projectnaptha.com...) — importants pour un
// usage hors ligne ou dans un réseau restreint. Non commités (voir .gitignore) : régénérés à
// chaque installation, à partir des dépendances npm réellement installées (jamais de dérive entre
// le binaire servi et la version déclarée dans package.json).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(racine, "public", "tesseract");
mkdirSync(destination, { recursive: true });

const fichiers = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core.wasm.js", "tesseract-core.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core.wasm", "tesseract-core.wasm"],
  // Variante "best_int" (quantifiée) : nettement plus légère que la variante standard (~700 Ko
  // contre ~6 Mo) pour une qualité de reconnaissance équivalente sur du texte imprimé/manuscrit
  // lisible — largeur suffisante pour une fiche technique de cuisine.
  ["node_modules/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz", "fra.traineddata.gz"],
];

for (const [source, nom] of fichiers) {
  copyFileSync(join(racine, source), join(destination, nom));
}

console.log(`Assets Tesseract copiés dans ${destination}`);
