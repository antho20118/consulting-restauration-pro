import type { LigneRecetteInput } from "../types/recette";

// Correspondances texte importé → article à mémoriser à l'enregistrement d'une recette (voir
// enregistrerAliasIngredients et AliasIngredientImport côté serveur), pour que le prochain import
// retrouve directement le bon article.
//
// Uniquement les lignes dont l'article a été confirmé par l'utilisateur (articleConfirme) : une
// correspondance mémorisée prime ensuite sur toute recherche (voir trouverArticle dans
// ligneImportee.ts). Mémoriser un rapprochement automatique laissé « à confirmer » reproduisait
// donc, à chaque import suivant et sans plus aucun avertissement, un rattachement peut-être faux.
export function correspondancesAMemoriser(lignes: LigneRecetteInput[]): { texte: string; articleId: number }[] {
  return lignes
    .filter((ligne) => ligne.texteIngredientImporte && ligne.articleId && ligne.articleConfirme)
    .map((ligne) => ({ texte: ligne.texteIngredientImporte!, articleId: ligne.articleId }));
}
