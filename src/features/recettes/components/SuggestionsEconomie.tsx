import { useEffect, useState } from "react";
import { getSuggestionsEconomie } from "../services/recetteService";
import type { SuggestionFournisseur } from "../types/recette";

type Props = {
  recetteId: number;
};

export default function SuggestionsEconomie({ recetteId }: Props) {
  const [suggestions, setSuggestions] = useState<SuggestionFournisseur[] | null>(null);

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
      <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 15 }}>💡 Suggestions fournisseurs</h3>
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
            <strong>{suggestion.article.nom}</strong> : {suggestion.fournisseurActuel.nom} (
            {suggestion.prixActuelParUniteBase.toFixed(4)} €/{suggestion.uniteBase}) →{" "}
            {suggestion.fournisseurAlternatif.nom} ({suggestion.prixAlternatifParUniteBase.toFixed(4)} €/
            {suggestion.uniteBase})
          </span>
          <span style={{ color: "var(--couleur-primaire-hover)", fontWeight: 600 }}>
            −{suggestion.economieEuros.toFixed(2)} € ({suggestion.economiePct.toFixed(0)}% moins cher)
            {suggestion.nouveauFoodCostPct != null &&
              ` · nouveau food cost : ${suggestion.nouveauFoodCostPct.toFixed(1)} %`}
          </span>
        </div>
      ))}
    </div>
  );
}
