import { useState } from "react";
import ChampNombre from "../../../common/ChampNombre";
import type { Recette } from "../types/recette";

type Props = {
  recette: Recette;
};

// Calcule les quantités d'ingrédients à commander pour produire une quantité cible (en portions
// ou en kg de plat fini), à partir du poids fini actuel de la recette (déduit du rendement et du
// gain à la cuisson de chaque ingrédient — voir calculerCoutRecette côté serveur). Ex. produire
// 100kg de sauté de veau fini en sachant qu'on perd 20% de viande à la cuisson mais qu'on gagne
// 80% d'eau par rapport à son poids.
export default function CalculateurProduction({ recette }: Props) {
  const [mode, setMode] = useState<"portions" | "kg">("portions");
  const [cible, setCible] = useState(recette.portions);

  const poidsFiniActuelKg = recette.poidsFiniTotalG / 1000;

  const echelle =
    mode === "portions"
      ? recette.portions > 0
        ? cible / recette.portions
        : 0
      : poidsFiniActuelKg > 0
        ? cible / poidsFiniActuelKg
        : 0;

  return (
    <div style={{ marginBottom: 20 }}>
      <h3>Calculateur de production</h3>
      <p style={{ fontSize: 12, color: "#888", marginTop: -8, marginBottom: 12 }}>
        Indique la quantité à produire : les quantités d'ingrédients à commander sont recalculées
        en tenant compte du rendement et du gain à la cuisson de chaque ingrédient.
      </p>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <button
              type="button"
              onClick={() => setMode("portions")}
              style={{ fontWeight: mode === "portions" ? "bold" : "normal" }}
            >
              Portions
            </button>
            <button
              type="button"
              onClick={() => poidsFiniActuelKg > 0 && setMode("kg")}
              disabled={poidsFiniActuelKg <= 0}
              title={poidsFiniActuelKg <= 0 ? "Aucun ingrédient dans cette recette" : ""}
              style={{ fontWeight: mode === "kg" ? "bold" : "normal" }}
            >
              Kg de plat fini
            </button>
          </div>
          <ChampNombre
            valeur={cible}
            onChanger={(n) => setCible(n ?? 0)}
            style={{ width: 140, padding: 10, boxSizing: "border-box" }}
          />
        </div>

        <div style={{ color: "#666" }}>
          Poids fini actuel de la recette ({recette.portions} portion
          {recette.portions > 1 ? "s" : ""}) : <strong>{poidsFiniActuelKg.toFixed(2)} kg</strong>
        </div>
      </div>

      {echelle > 0 && recette.lignes.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "6px 0" }}>Ingrédient</th>
              <th style={{ padding: "6px 0" }}>À commander</th>
            </tr>
          </thead>
          <tbody>
            {recette.lignes.map((ligne) => (
              <tr key={ligne.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 0" }}>{ligne.article.nom}</td>
                <td style={{ padding: "6px 0" }}>
                  {(ligne.quantite * echelle).toFixed(2)} {ligne.unite.symbole}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
