import { createWorker } from "tesseract.js";

// OCR gratuit (Tesseract, open source) utilisé en repli quand l'import par IA n'est pas configuré
// (voir ImporterRecetteModal.tsx) : charge le moteur et les données de langue française depuis
// public/tesseract/ (voir scripts/copierAssetsTesseract.mjs, exécuté après chaque `npm install`),
// jamais un CDN externe — un réseau restreint ou hors ligne ne doit jamais empêcher cette
// fonctionnalité de fonctionner après l'installation. Nettement moins fiable que la lecture par IA,
// en particulier sur une recette manuscrite ou une photo de mauvaise qualité — le texte reconnu est
// ensuite passé au même analyseur par règles que le mode texte, avec les mêmes limites.
export async function extraireTexteDePhoto(photoDataUrl: string): Promise<string> {
  try {
    const worker = await createWorker("fra", undefined, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/tesseract-core.wasm.js",
      langPath: "/tesseract",
    });
    try {
      const {
        data: { text },
      } = await worker.recognize(photoDataUrl);
      return text;
    } finally {
      await worker.terminate();
    }
  } catch {
    throw new Error(
      "Impossible de charger le lecteur de photo. Réessaie, ou utilise le mode texte."
    );
  }
}
