import type { ArticleRecette } from "../types/recette";

// Le classeur de coûts de recettes d'origine est bâti sur les produits Super U : de nombreux
// articles portant un nom proche existent aussi chez d'autres fournisseurs, ce qui rend la
// recherche (manuelle comme automatique à l'import) ambiguë si on ne filtre pas. Se base sur le
// tarif actif le plus récent de l'article (le seul renvoyé par l'API, voir inclusionsArticle côté
// serveur). Préférence partagée entre la recherche manuelle (RecetteForm.tsx) et le rapprochement
// automatique à l'import (ImporterRecetteModal.tsx), pour un comportement cohérent partout.
const CLE_FILTRE_SUPER_U = "consulting_filtre_super_u";

export function filtrerSuperUActif(): boolean {
  try {
    return localStorage.getItem(CLE_FILTRE_SUPER_U) !== "non";
  } catch {
    return true;
  }
}

export function definirFiltrerSuperU(valeur: boolean): void {
  try {
    localStorage.setItem(CLE_FILTRE_SUPER_U, valeur ? "oui" : "non");
  } catch {
    // Préférence non mémorisée (stockage indisponible) : sans conséquence, seulement pour la
    // session en cours.
  }
}

export function estFournisseurSuperU(article: ArticleRecette): boolean {
  const nomFournisseur = article.tarifs[0]?.fournisseur?.nom ?? "";
  return nomFournisseur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .includes("super u");
}
