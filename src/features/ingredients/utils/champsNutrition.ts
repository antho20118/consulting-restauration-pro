// Libellés affichés dans l'ordre d'une étiquette nutritionnelle réelle, valeurs saisies "pour
// 100g" de l'unité de base de l'article (voir server/utils/coutRecette.ts, CHAMPS_NUTRITION côté
// serveur). Fichier à part (plutôt qu'exporté depuis IngredientForm.tsx) : react-refresh exige
// qu'un fichier de composant n'exporte que des composants, voir la règle
// react-refresh/only-export-components. Réutilisé tel quel par ImporterNutritionModal.tsx pour
// préremplir exactement les mêmes champs, dans le même ordre, plutôt que de les dupliquer.
export const CHAMPS_NUTRITION = [
  { cle: "energie", label: "Énergie (kcal)" },
  { cle: "proteines", label: "Protéines (g)" },
  { cle: "glucides", label: "Glucides (g)" },
  { cle: "sucres", label: "dont sucres (g)" },
  { cle: "lipides", label: "Lipides (g)" },
  { cle: "acidesGrasSatures", label: "dont acides gras saturés (g)" },
  { cle: "fibres", label: "Fibres (g)" },
  { cle: "sel", label: "Sel (g)" },
] as const;
export type ChampNutritionCle = (typeof CHAMPS_NUTRITION)[number]["cle"];
