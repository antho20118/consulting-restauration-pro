import { useEffect, useState } from "react";
import { getSuggestionsEconomie } from "../services/recetteService";
import type { SuggestionEconomie } from "../types/recette";

type Props = {
  recetteId: number;
};

export default function SuggestionsEconomie({ recetteId }: Props) {
  const [suggestions, setSuggestions] = useState<SuggestionEconomie[] | null>(null);

  useEffect(() => {
    getSuggestionsEconomie(recetteId)
      .then(setSuggestions)
      .catch(() => setSuggestions([]));
  }, [recetteId]);

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--couleur-primaire-clair)",
        borderRadius: 8,
        padding: 14,
        marginBottom: 20,
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 15 }}>💡 Suggestions d'économies</h3>
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.ligneId}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: 6,
            padding: "6px 0",
          }}
        >
          <span>
            Remplacer <strong>{suggestion.articleActuel.nom}</strong> par{" "}
            <strong>{suggestion.articleSuggere.nom}</strong>
          </span>
          <span style={{ color: "var(--couleur-primaire-hover)", fontWeight: 600 }}>
            −{suggestion.economieParPortion.toFixed(2)} €/portion ({suggestion.economiePct.toFixed(0)}
            % moins cher)
            {suggestion.nouveauFoodCostPct != null &&
              ` · nouveau food cost : ${suggestion.nouveauFoodCostPct.toFixed(1)} %`}
          </span>
        </div>
      ))}
    </div>
  );
}
