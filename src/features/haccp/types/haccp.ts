// Miroir de server/utils/haccp.ts (RegleHACCP) — dupliqué délibérément entre client et serveur,
// jamais de module TypeScript partagé dans ce projet (même convention que le reste de
// l'application). motsCles est inclus ici (contrairement au type du même nom utilisé par
// RecetteDetail.tsx, features/recettes/types/recette.ts) : cette page de référence affiche aussi
// les mots-clés qui déclenchent la détection automatique, un renseignement sans objet dans le
// contexte d'une étape déjà évaluée.
export interface RegleHACCP {
  code: string;
  nom: string;
  motsCles: string[];
  risque: string;
  mesurePreventive: string;
  limiteCritique: string;
  surveillance: string;
  actionCorrective: string;
}
