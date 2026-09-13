import { createWorker } from "tesseract.js";

// OCR gratuit (Tesseract, open source) utilisé en repli quand l'import par IA n'est pas configuré
// (voir ImporterRecetteModal.tsx) : charge le moteur et les données de langue française depuis un
// CDN public au premier appel (quelques Mo, mis en cache par le navigateur ensuite). Nettement
// moins fiable que la lecture par IA, en particulier sur une recette manuscrite ou une photo de
// mauvaise qualité — le texte reconnu est ensuite passé au même analyseur par règles que le mode
// texte, avec les mêmes limites.
export async function extraireTexteDePhoto(photoDataUrl: string): Promise<string> {
  try {
    const worker = await createWorker("fra");
    try {
      const {
        data: { text },
      } = await worker.recognize(photoDataUrl);
      return text;
    } finally {
      await worker.terminate();
    }
  } catch {
    // Tesseract charge son moteur et les données de langue depuis un CDN au premier appel : une
    // erreur ici est presque toujours un problème de connexion, pas une erreur de lecture.
    throw new Error(
      "Impossible de charger le lecteur de photo (connexion internet nécessaire au premier essai). Réessaie, ou utilise le mode texte."
    );
  }
}
