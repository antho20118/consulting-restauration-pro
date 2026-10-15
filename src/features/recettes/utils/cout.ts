import type { ArticleRecette, UniteRecette } from "../types/recette";

// Reproduit côté client le calcul fait par le serveur (server/routes/recettes.ts)
// pour afficher un coût estimé pendant l'édition, avant l'enregistrement.
export function estimerCoutLigne(
  article: ArticleRecette | undefined,
  quantite: number,
  unite: UniteRecette | undefined
): number {
  const tarif = article?.tarifs[0];
  if (!tarif || !unite) return 0;

  if (tarif.quantiteConditionnement <= 0 || tarif.unite.facteurBase <= 0) return 0;

  const prixParUniteBase =
    tarif.prixHT / (tarif.quantiteConditionnement * tarif.unite.facteurBase);
  const quantiteBase = quantite * unite.facteurBase;

  // Quantité brute achetée : le rendement ne réduit jamais le coût (voir calculerCoutRecette).
  return quantiteBase * prixParUniteBase;
}
