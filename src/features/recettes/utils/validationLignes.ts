import type { AllergeneRecette, ArticleRecette, LigneRecetteInput } from "../types/recette";

// Ce qui manque sur une ligne pour pouvoir enregistrer la recette. "unite" couvre en particulier
// une ligne issue d'un import IA/OCR dont l'unité n'a pas pu être reconnue (voir
// construireLigneImportee dans ligneImportee.ts, qui laisse alors uniteId à 0 plutôt que de
// deviner une unité) : contrairement à un article manquant, ce cas passait auparavant inaperçu
// (repli silencieux sur le kg), d'où un contrôle bloquant dédié plutôt qu'un simple avertissement.
export function ligneIncomplete(ligne: LigneRecetteInput): "article" | "unite" | null {
  if (!ligne.articleId) return "article";
  if (!ligne.uniteId) return "unite";
  return null;
}

export type AllergenesRecette = {
  allergenes: AllergeneRecette[];
  // true si au moins un des ingrédients contribuant à cette liste vient d'un rapprochement
  // automatique pas encore confirmé par l'utilisateur (voir LigneRecetteInput.articleConfirme) :
  // la liste peut alors être incomplète ou contenir un allergène qui ne correspond pas au bon
  // ingrédient, tant que ce rapprochement n'a pas été vérifié.
  incertain: boolean;
};

// Déduit les allergènes de la recette par union de ceux des ingrédients sélectionnés, plutôt que
// de les faire ressaisir manuellement (qui pourrait diverger des ingrédients réellement
// utilisés) — et signale si cette déduction s'appuie encore sur un rapprochement d'article non
// confirmé, pour que l'écran puisse avertir l'utilisateur au lieu de présenter la liste comme
// définitive.
export function calculerAllergenesAvecStatut(
  lignes: LigneRecetteInput[],
  articles: ArticleRecette[]
): AllergenesRecette {
  const parId = new Map<number, string>();
  let incertain = false;

  for (const ligne of lignes) {
    const article = articles.find((a) => a.id === ligne.articleId);
    if (!article) continue;
    if (!ligne.articleConfirme) incertain = true;
    for (const { allergene } of article.allergenes) {
      parId.set(allergene.id, allergene.nom);
    }
  }

  const allergenes = Array.from(parId, ([id, nom]) => ({ id, nom })).sort((a, b) =>
    a.nom.localeCompare(b.nom)
  );
  return { allergenes, incertain };
}
