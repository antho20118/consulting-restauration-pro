// Normalisation partagée (accents, casse, espaces) pour toute comparaison approximative de texte
// côté client : recherche d'article (RechercheArticle.tsx), rapprochement d'ingrédient à l'import
// (ImporterRecetteModal.tsx), filtre fournisseur (filtreFournisseur.ts). Doit rester identique à
// normaliserTexte() côté serveur (server/utils/normaliserTexte.ts) pour la mémoire de
// correspondance (AliasIngredientImport), qui est indexée sur ce même calcul.
const DIACRITIQUES = /[̀-ͯ]/g;

export function normaliserTexte(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(DIACRITIQUES, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
