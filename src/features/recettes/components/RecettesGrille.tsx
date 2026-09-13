import { ChefHat } from "lucide-react";
import type { Recette } from "../types/recette";

type Props = {
  recettes: Recette[];
  onOuvrir: (recette: Recette) => void;
};

export default function RecettesGrille({ recettes, onOuvrir }: Props) {
  if (recettes.length === 0) {
    return <p style={{ color: "var(--couleur-texte-attenue)" }}>Aucune recette.</p>;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: 16,
      }}
    >
      {recettes.map((recette) => (
        <button
          key={recette.id}
          onClick={() => onOuvrir(recette)}
          style={{
            display: "flex",
            flexDirection: "column",
            padding: 0,
            overflow: "hidden",
            borderRadius: "var(--rayon)",
            boxShadow: "var(--ombre-carte)",
            textAlign: "left",
          }}
        >
          <div
            style={{
              width: "100%",
              aspectRatio: "4 / 3",
              background: "#eef1f3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {recette.photo ? (
              <img
                src={recette.photo}
                alt={recette.nom}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <ChefHat size={32} color="#aab2ba" />
            )}
          </div>
          <div style={{ padding: "10px 12px", fontWeight: 600 }}>{recette.nom}</div>
        </button>
      ))}
    </div>
  );
}
