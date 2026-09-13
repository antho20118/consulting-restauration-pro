import type { RecetteAlerte } from "../types/dashboard";
import { statutFoodCost } from "../utils/statutFoodCost";

type Props = {
  recettes: RecetteAlerte[];
};

export default function RecettesAlerteTable({ recettes }: Props) {
  if (recettes.length === 0) {
    return (
      <p style={{ color: "#0ca30c" }}>✓ Aucune recette ne nécessite d'attention pour le moment.</p>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left", color: "#52514e", fontSize: 13 }}>
          <th style={{ padding: "8px 0", fontWeight: 500 }}>Recette</th>
          <th style={{ padding: "8px 0", fontWeight: 500 }}>Food cost</th>
          <th style={{ padding: "8px 0", fontWeight: 500 }}>Coût / portion</th>
          <th style={{ padding: "8px 0", fontWeight: 500 }}>Prix de vente HT</th>
        </tr>
      </thead>
      <tbody>
        {recettes.map((recette) => {
          const statut = statutFoodCost(recette.foodCostPct);
          return (
            <tr key={recette.id} style={{ borderTop: "1px solid #e1e0d9" }}>
              <td style={{ padding: "10px 0" }}>{recette.nom}</td>
              <td style={{ padding: "10px 0" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: statut.couleur,
                    marginRight: 8,
                  }}
                />
                {recette.foodCostPct.toFixed(1)} % · {statut.label}
              </td>
              <td style={{ padding: "10px 0", fontVariantNumeric: "tabular-nums" }}>
                {recette.coutParPortion.toFixed(2)} €
              </td>
              <td style={{ padding: "10px 0", fontVariantNumeric: "tabular-nums" }}>
                {recette.prixVenteHT.toFixed(2)} €
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
