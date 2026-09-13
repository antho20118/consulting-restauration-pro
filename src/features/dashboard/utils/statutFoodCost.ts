// Seuils usuels de food cost en restauration : en dessous de 28 %, c'est confortable ;
// au-delà de 35 %, la marge est mise en danger.
const SEUIL_BON = 28;
const SEUIL_ATTENTION = 35;

export const COULEURS_STATUT = {
  bon: "#0ca30c",
  attention: "#fab219",
  critique: "#d03b3b",
} as const;

export function statutFoodCost(foodCostPct: number): {
  label: string;
  couleur: string;
} {
  if (foodCostPct <= SEUIL_BON) return { label: "Bon", couleur: COULEURS_STATUT.bon };
  if (foodCostPct <= SEUIL_ATTENTION)
    return { label: "À surveiller", couleur: COULEURS_STATUT.attention };
  return { label: "Critique", couleur: COULEURS_STATUT.critique };
}
