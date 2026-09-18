import type { UniteRecette } from "../types/recette";

// Unité présélectionnée pour une nouvelle ligne d'ingrédient (ajout manuel, ou import sans unité
// reconnue) : le kg, la plus utilisée en pratique pour des recettes de cuisine, plutôt que la
// première unité renvoyée par l'API (triée alphabétiquement, donc "Boîte" en pratique).
export function trouverUniteParDefaut(unites: UniteRecette[]): UniteRecette | undefined {
  return unites.find((u) => u.symbole === "kg") ?? unites[0];
}
