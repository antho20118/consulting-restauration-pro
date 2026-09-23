export type ModeQuantite = "portions" | "poids";

// Un poids de portion doit être strictement positif pour pouvoir convertir un poids total en
// nombre de portions — sans lui, le mode "Kg" n'a aucun sens.
export function peutPasserEnModeKg(poidsPortionG: number): boolean {
  return poidsPortionG > 0;
}

// Poids total (kg) affiché en entrant en mode Kg, dérivé du nombre de portions actuel.
export function poidsTotalInitialKg(portions: number, poidsPortionG: number): number {
  return (portions * poidsPortionG) / 1000;
}

// Nouveau nombre de portions correspondant à un poids total saisi en mode Kg. `null` si la
// conversion est impossible (poids de portion non renseigné) : l'appelant ne doit alors PAS mettre
// à jour `portions`, plutôt que de le figer silencieusement à son ancienne valeur sans le dire (le
// bug corrigé ici) — ce cas ne devrait de toute façon plus être atteignable une fois
// modeApresChangementPoidsPortion appliqué à chaque changement du poids d'une portion.
export function portionsDepuisPoidsTotalKg(kg: number, poidsPortionG: number): number | null {
  if (poidsPortionG <= 0) return null;
  return Math.max(1, Math.round((kg * 1000) / poidsPortionG));
}

// Mode à appliquer après un changement du poids d'une portion. Si le poids de portion redevient
// nul ou négatif alors qu'on est en mode Kg, ce mode n'a plus de sens : on revient automatiquement
// en mode Portions plutôt que de laisser le champ Kg accepter des saisies qui ne répercuteraient
// plus jamais rien sur la quantité réelle (le champ affichait la nouvelle valeur tapée, mais
// `portions` restait figé à sa dernière valeur valide, silencieusement).
export function modeApresChangementPoidsPortion(
  modeActuel: ModeQuantite,
  nouveauPoidsPortionG: number
): ModeQuantite {
  if (modeActuel === "poids" && nouveauPoidsPortionG <= 0) return "portions";
  return modeActuel;
}
