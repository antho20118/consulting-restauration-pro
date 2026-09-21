export type UniteAvecFacteurBase = { facteurBase: number };

// Source unique de conversion d'une quantité de recette (ligne d'ingrédient, besoin d'achat...)
// vers l'unité de base de sa famille (le gramme pour un poids, le mL pour un volume, la
// pièce/l'unité pour un dénombrable) — voir Unite.facteurBase.
//
// Accepte soit une entité Unite (le cas courant : coutRecette.ts, planifierProduction.ts,
// suggestionsEconomie.ts portent toutes un ligne.unite issu de la relation Prisma), soit un
// facteur déjà extrait sous forme de nombre brut (le cas de achats.ts, dont le contrat HTTP reçoit
// facteurUniteRecette séparément de la quantité, sans jamais charger d'entité Unite).
//
// Avant l'introduction de ce helper, cette même règle (quantite * facteurBase) était réécrite
// indépendamment à quatre endroits ; l'un d'eux avait été oublié (voir planifierProduction.ts,
// PR #55), ce qui avait produit un besoinNet et un quantiteProduction faux d'un facteur
// facteurBase. Centraliser la règle et sa validation ici rend ce type d'oubli impossible à
// reproduire silencieusement dans un nouvel appelant.
export function versUniteBase(quantite: number, unite: UniteAvecFacteurBase | number): number {
  const facteurBase = typeof unite === "number" ? unite : unite.facteurBase;

  if (!Number.isFinite(quantite) || quantite < 0) {
    throw new Error("Quantité invalide");
  }
  if (!Number.isFinite(facteurBase) || facteurBase <= 0) {
    throw new Error("Facteur d'unité invalide");
  }

  return quantite * facteurBase;
}
