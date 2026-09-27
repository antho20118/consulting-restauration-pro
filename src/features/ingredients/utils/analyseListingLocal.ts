import type { LigneListingExtraite } from "../services/listingFournisseurService";

// Repli gratuit sans IA (voir server/utils/importListingPhotoIA.ts et la même logique déjà
// appliquée à l'import recette, analyseRecetteLocale.ts) : analyse par règles simples du texte lu
// par OCR (extraireTexteDePhoto, Tesseract) quand ANTHROPIC_API_KEY n'est pas configurée.
// Nettement moins fiable qu'une extraction par vision IA — l'utilisateur en est informé (voir le
// message affiché par le composant appelant) et chaque ligne reste soumise au même rapprochement
// et à la même validation humaine avant tarif.
//
// Une ligne de listing se termine généralement par un prix (ex. "EMMENTAL CUBE 500G 6,50" ou
// "6,50 €") : tout ce qui précède ce dernier nombre est pris comme désignation. Une ligne sans
// prix identifiable n'est jamais retenue (mieux vaut l'ignorer que d'inventer un prix).
const RE_PRIX_FIN_DE_LIGNE = /(\d+[.,]\d{1,2})\s*(?:€|EUR)?\s*$/i;

export function analyserListingLocal(texte: string): LigneListingExtraite[] {
  const lignes = texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const resultat: LigneListingExtraite[] = [];

  for (const ligne of lignes) {
    const correspondance = RE_PRIX_FIN_DE_LIGNE.exec(ligne);
    if (!correspondance) continue;

    const designation = ligne.slice(0, correspondance.index).trim();
    if (!designation) continue;

    resultat.push({
      designation,
      reference: null,
      prix: correspondance[1],
      conditionnement: null,
    });
  }

  return resultat;
}
