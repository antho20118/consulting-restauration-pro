// Normalisation partagée entre le client (recherche/correspondance d'articles à l'import) et le
// serveur (clé de la table AliasIngredientImport) : les deux doivent produire exactement la même
// clé pour un même texte, sans quoi la mémoire de correspondance ne retrouverait jamais ses alias.
const DIACRITIQUES = /[̀-ͯ]/g;

export function normaliserTexte(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(DIACRITIQUES, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
