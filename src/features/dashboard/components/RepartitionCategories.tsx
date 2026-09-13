import type { RepartitionCategorie } from "../types/dashboard";

type Props = {
  repartition: RepartitionCategorie[];
};

const COULEUR_BARRE = "#16a085";
const PISTE = "#e1e0d9";

export default function RepartitionCategories({ repartition }: Props) {
  if (repartition.length === 0) {
    return <p style={{ color: "#898781" }}>Aucune recette pour le moment.</p>;
  }

  const maxCount = Math.max(...repartition.map((item) => item.count));

  return (
    <div>
      {repartition.map((item) => (
        <div
          key={item.categorie}
          style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}
        >
          <div style={{ width: 140, fontSize: 14, color: "#52514e", textAlign: "right" }}>
            {item.categorie}
          </div>

          <div style={{ flex: 1, background: PISTE, borderRadius: 4, height: 16 }}>
            <div
              style={{
                width: `${(item.count / maxCount) * 100}%`,
                background: COULEUR_BARRE,
                height: 16,
                borderRadius: "0 4px 4px 0",
              }}
            />
          </div>

          <div
            style={{
              width: 24,
              fontSize: 14,
              color: "#0b0b0b",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {item.count}
          </div>
        </div>
      ))}
    </div>
  );
}
