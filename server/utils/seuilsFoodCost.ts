// Seuils métier du food cost — source unique côté serveur, utilisée à la fois par le tableau de
// bord (server/routes/dashboard.ts) et par l'agent Consulting (server/routes/consulting.ts).
//
// Reprennent exactement l'échelle déjà définie et affichée côté frontend
// (src/features/dashboard/utils/statutFoodCost.ts, table "recettes à risque" du dashboard) :
// ≤28 % Bon, 28-35 % À surveiller, >35 % Critique. Frontend et backend sont deux projets
// TypeScript distincts (moduleResolution différente, pas de dossier partagé dans ce dépôt) et ne
// peuvent donc pas importer littéralement le même fichier — ces valeurs doivent rester identiques
// dans les deux fichiers si elles changent un jour.
//
// Avant ce fichier, server/routes/dashboard.ts et server/routes/consulting.ts définissaient chacun
// leur propre seuil en dur (28 et 35 respectivement), sans jamais se référencer l'un l'autre ni
// l'échelle frontend — Consulting n'alertait qu'au palier "Critique", ignorant silencieusement le
// palier "À surveiller" pourtant affiché ailleurs dans l'application pour la même donnée.
export const SEUIL_BON = 28;
export const SEUIL_ATTENTION = 35;

export type NiveauFoodCost = "bon" | "attention" | "critique";

export function niveauFoodCost(foodCostPct: number): NiveauFoodCost {
  if (foodCostPct <= SEUIL_BON) return "bon";
  if (foodCostPct <= SEUIL_ATTENTION) return "attention";
  return "critique";
}
