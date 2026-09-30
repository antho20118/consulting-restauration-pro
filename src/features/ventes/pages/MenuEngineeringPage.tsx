import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  getMenuEngineering,
  type ItemMenuEngineering,
  type QuadrantMenuEngineering,
  type ResultatMenuEngineering,
} from "../services/venteService";

const QUADRANTS: {
  cle: QuadrantMenuEngineering;
  titre: string;
  emoji: string;
  description: string;
  couleur: string;
}[] = [
  {
    cle: "VEDETTE",
    titre: "Vedettes",
    emoji: "⭐",
    description: "Populaires et rentables : à préserver, jamais à modifier à la légère.",
    couleur: "#1e7e34",
  },
  {
    cle: "CHEVAL_DE_TRAIT",
    titre: "Chevaux de trait",
    emoji: "🐴",
    description: "Populaires mais peu rentables : leur volume justifie de retravailler le coût ou le prix.",
    couleur: "#946200",
  },
  {
    cle: "ENIGME",
    titre: "Énigmes",
    emoji: "❓",
    description: "Rentables mais peu vendues : à mettre en avant (carte, suggestion du jour) avant d'y renoncer.",
    couleur: "#1a5fb4",
  },
  {
    cle: "POIDS_MORT",
    titre: "Poids morts",
    emoji: "🐢",
    description: "Ni populaires ni rentables : candidates naturelles à une refonte ou un retrait du menu.",
    couleur: "#b3261e",
  },
];

function formaterEuros(valeur: number): string {
  return `${valeur.toFixed(2)} €`;
}

// Classement des recettes (méthode Kasavana & Smith, voir server/routes/ventes.ts) croisant
// popularité (quantités vendues, chantier ventes) et rentabilité (marge actuelle, moteur de coût) —
// jamais un calcul supplémentaire côté client, uniquement l'affichage de ce que le serveur a déjà
// classé.
export default function MenuEngineeringPage() {
  const [resultat, setResultat] = useState<ResultatMenuEngineering | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    getMenuEngineering()
      .then(setResultat)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Erreur inconnue"))
      .finally(() => setChargement(false));
  }, []);

  const itemsParQuadrant = (cle: QuadrantMenuEngineering): ItemMenuEngineering[] =>
    (resultat?.items ?? [])
      .filter((item) => item.quadrant === cle)
      .sort((a, b) => b.quantiteVendue - a.quantiteVendue);

  return (
    <div style={{ padding: 20 }}>
      <h1>📊 Menu engineering</h1>
      <p style={{ color: "var(--couleur-texte-attenue)", marginTop: -8, marginBottom: 20 }}>
        Classe chaque recette vendue selon sa popularité (quantités vendues, voir l'import de
        ventes) et sa rentabilité (marge actuelle, moteur de coût) — méthode Kasavana &amp; Smith,
        une référence du secteur, pas un calcul maison.
      </p>

      {chargement && <p style={{ color: "#666" }}>Chargement…</p>}

      {resultat && resultat.items.length === 0 && (
        <p style={{ color: "#666" }}>
          Aucune recette avec un prix de vente configuré pour l'instant — renseigne un prix de
          vente sur au moins une recette pour voir apparaître ce classement.
        </p>
      )}

      {resultat && resultat.items.length > 0 && (
        <>
          <div
            style={{
              background: "white",
              borderRadius: 10,
              padding: 16,
              marginBottom: 20,
              fontSize: 13,
              color: "var(--couleur-texte-attenue)",
              display: "flex",
              gap: 24,
              flexWrap: "wrap",
            }}
          >
            <span>
              Seuil de popularité :{" "}
              <strong>
                {resultat.seuilPopulariteQuantite != null
                  ? `${resultat.seuilPopulariteQuantite.toFixed(1)} unités vendues`
                  : "—"}
              </strong>
            </span>
            <span>
              Marge moyenne pondérée :{" "}
              <strong>
                {resultat.margeMoyennePonderee != null ? formaterEuros(resultat.margeMoyennePonderee) : "—"}
              </strong>
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 20,
            }}
          >
            {QUADRANTS.map((quadrant) => {
              const items = itemsParQuadrant(quadrant.cle);
              return (
                <div
                  key={quadrant.cle}
                  style={{
                    background: "white",
                    borderRadius: 10,
                    padding: 20,
                    boxShadow: "0 1px 3px rgba(0,0,0,.08)",
                    borderTop: `4px solid ${quadrant.couleur}`,
                  }}
                >
                  <h3 style={{ marginTop: 0 }}>
                    {quadrant.emoji} {quadrant.titre}{" "}
                    <span style={{ fontSize: 13, color: "var(--couleur-texte-attenue)", fontWeight: 400 }}>
                      ({items.length})
                    </span>
                  </h3>
                  <p style={{ fontSize: 13, color: "var(--couleur-texte-attenue)", marginTop: -6 }}>
                    {quadrant.description}
                  </p>

                  {items.length === 0 && <p style={{ color: "#999", fontSize: 13 }}>Aucune recette ici.</p>}

                  {items.map((item) => (
                    <div
                      key={item.recetteId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "8px 0",
                        borderBottom: "1px solid #f0f0f0",
                      }}
                    >
                      <span>{item.recetteNom}</span>
                      <span style={{ textAlign: "right", fontSize: 12, color: "var(--couleur-texte-attenue)" }}>
                        {item.quantiteVendue} vendu(s)
                        <br />
                        marge {formaterEuros(item.margeUnitaire)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
