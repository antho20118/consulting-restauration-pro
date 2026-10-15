import type { ArticleRecette, UniteRecette } from "../types/recette";

// Même règle que verifierFamilleUnite (server/utils/coutRecette.ts) : « piece » et « unite » sont
// une seule famille ; une unité sans type connu n'est jamais comparée.
function familleUnite(type: string | undefined): string | null {
  if (!type) return null;
  const t = type.trim().toLowerCase();
  if (t === "piece" || t === "pièce" || t === "unite" || t === "unité") return "unite";
  return t;
}

// Unité de la ligne d'une autre famille (poids, volume, pièce) que le tarif de l'article : le
// serveur refuse la ligne à l'enregistrement (point 3 de l'audit du 15/10).
export function uniteIncompatible(article: ArticleRecette | undefined, unite: UniteRecette | undefined): boolean {
  const tarif = article?.tarifs[0];
  if (!tarif || !unite) return false;
  const familleLigne = familleUnite(unite.type);
  const familleTarif = familleUnite(tarif.unite.type);
  return familleLigne !== null && familleTarif !== null && familleLigne !== familleTarif;
}

// Reproduit côté client le calcul fait par le serveur (server/routes/recettes.ts)
// pour afficher un coût estimé pendant l'édition, avant l'enregistrement.
export function estimerCoutLigne(
  article: ArticleRecette | undefined,
  quantite: number,
  unite: UniteRecette | undefined
): number {
  const tarif = article?.tarifs[0];
  if (!tarif || !unite) return 0;
  // Ligne refusée par le serveur : aucun coût plutôt qu'un chiffre faux (100 g × prix à la pièce).
  if (uniteIncompatible(article, unite)) return 0;

  if (tarif.quantiteConditionnement <= 0 || tarif.unite.facteurBase <= 0) return 0;

  const prixParUniteBase =
    tarif.prixHT / (tarif.quantiteConditionnement * tarif.unite.facteurBase);
  const quantiteBase = quantite * unite.facteurBase;

  // Quantité brute achetée : le rendement ne réduit jamais le coût (voir calculerCoutRecette).
  return quantiteBase * prixParUniteBase;
}
