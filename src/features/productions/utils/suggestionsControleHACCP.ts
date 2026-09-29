// Suggestions rapides de valeur constatée, propres au thème de chaque règle HACCP détectée (voir
// server/utils/haccp.ts pour la liste des règles et leurs codes) — un clic pré-remplit le champ
// texte libre et coche/décoche "Conforme" en conséquence, plutôt que de tout taper à la main.
// Jamais un menu fermé : le champ texte reste toujours modifiable ensuite (une valeur mesurée
// réelle, ex. une température précise, ne rentre pas dans une liste fixe) — voir la discussion de
// cadrage. Un point critique déclaré manuellement (sans règle détectée) n'a pas de thème connu :
// aucune suggestion, texte libre uniquement.

export type SuggestionControle = { texte: string; conforme: boolean };

export const SUGGESTIONS_PAR_REGLE: Record<string, SuggestionControle[]> = {
  LEGUMES_CRUS: [
    { texte: "Légumes triés, lavés et désinfectés selon le protocole", conforme: true },
    { texte: "Protocole de désinfection non respecté", conforme: false },
  ],
  CUISSON: [
    { texte: "Température à cœur conforme à la procédure", conforme: true },
    { texte: "Température à cœur non atteinte", conforme: false },
  ],
  REFROIDISSEMENT: [
    { texte: "Refroidissement rapide en cellule, +10°C atteint en moins de 2h", conforme: true },
    { texte: "Délai de refroidissement dépassé", conforme: false },
  ],
  REMISE_TEMPERATURE: [
    { texte: "Remise en température rapide, +63°C atteint", conforme: true },
    { texte: "+63°C non atteint dans le délai", conforme: false },
  ],
  FROID: [
    { texte: "Chaîne du froid respectée, température conforme", conforme: true },
    { texte: "Rupture de la chaîne du froid détectée", conforme: false },
  ],
};

// Regroupe les suggestions de toutes les règles détectées sur une étape (rarement plus d'une,
// mais jamais supposé) sans doublon de texte.
export function suggestionsPourEtape(codesRegles: string[]): SuggestionControle[] {
  const vues = new Set<string>();
  const resultat: SuggestionControle[] = [];
  for (const code of codesRegles) {
    for (const suggestion of SUGGESTIONS_PAR_REGLE[code] ?? []) {
      if (vues.has(suggestion.texte)) continue;
      vues.add(suggestion.texte);
      resultat.push(suggestion);
    }
  }
  return resultat;
}
