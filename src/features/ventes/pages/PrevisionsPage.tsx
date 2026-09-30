import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getPrevisions, type PrevisionRecette, type ResultatPrevisions, type TendancePrevision } from "../services/venteService";

function formaterEuros(valeur: number): string {
  return `${valeur.toFixed(2)} €`;
}

const BADGE_TENDANCE: Record<TendancePrevision, { emoji: string; label: string; couleur: string }> = {
  hausse: { emoji: "📈", label: "En hausse", couleur: "#1e7e34" },
  stable: { emoji: "➡️", label: "Stable", couleur: "#946200" },
  baisse: { emoji: "📉", label: "En baisse", couleur: "#b3261e" },
};

// Prévision par moyenne mobile (voir server/routes/ventes.ts) : une méthode simple et explicable,
// pas un modèle statistique sophistiqué — chaque document de ventes importé et validé compte pour
// une période. Jamais présenté comme une garantie, seulement une estimation à partir de
// l'historique réel.
export default function PrevisionsPage() {
  const [resultat, setResultat] = useState<ResultatPrevisions | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    getPrevisions()
      .then(setResultat)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Erreur inconnue"))
      .finally(() => setChargement(false));
  }, []);

  const items = [...(resultat?.items ?? [])].sort((a, b) => b.previsionProchainePeriode - a.previsionProchainePeriode);

  return (
    <div style={{ padding: 20 }}>
      <h1>🔮 Prévisions de ventes</h1>
      <p style={{ color: "var(--couleur-texte-attenue)", marginTop: -8, marginBottom: 20 }}>
        Estimation de la prochaine période à partir de l'historique réel de tes imports de ventes
        validés (moyenne mobile sur les 3 dernières périodes) — une estimation simple, pas une
        prédiction garantie.
      </p>

      {chargement && <p style={{ color: "#666" }}>Chargement…</p>}

      {resultat && resultat.nbPeriodes < 2 && (
        <p style={{ color: "#666" }}>
          Au moins 2 périodes de ventes importées et validées sont nécessaires pour établir une
          prévision — importe un second relevé de ventes (voir la page Ventes) pour voir apparaître
          ce tableau.
        </p>
      )}

      {resultat && resultat.nbPeriodes >= 2 && (
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
              Basé sur <strong>{resultat.nbPeriodes}</strong> période(s) de ventes importées
            </span>
            <span>
              Quantité totale estimée (prochaine période) :{" "}
              <strong>{resultat.previsionQuantiteTotale.toFixed(1)}</strong>
            </span>
            <span>
              Chiffre d'affaires estimé (prochaine période) :{" "}
              <strong>{resultat.previsionCaTotale != null ? formaterEuros(resultat.previsionCaTotale) : "—"}</strong>
            </span>
          </div>

          {items.length === 0 && <p style={{ color: "#666" }}>Aucune recette avec un historique de ventes pour l'instant.</p>}

          {items.length > 0 && (
            <div style={{ background: "white", borderRadius: 10, overflowX: "auto", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                    <th style={{ padding: 12 }}>Recette</th>
                    <th style={{ padding: 12 }}>Historique (quantités)</th>
                    <th style={{ padding: 12 }}>Tendance</th>
                    <th style={{ padding: 12 }}>Prévision prochaine période</th>
                    <th style={{ padding: 12 }}>CA estimé</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: PrevisionRecette) => {
                    const badge = BADGE_TENDANCE[item.tendance];
                    return (
                      <tr key={item.recetteId} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        <td style={{ padding: 12 }}>{item.recetteNom}</td>
                        <td style={{ padding: 12, color: "var(--couleur-texte-attenue)" }}>
                          {item.historique.join(" → ")}
                        </td>
                        <td style={{ padding: 12, color: badge.couleur, fontWeight: 600 }}>
                          {badge.emoji} {badge.label}
                        </td>
                        <td style={{ padding: 12 }}>{item.previsionProchainePeriode.toFixed(1)}</td>
                        <td style={{ padding: 12 }}>
                          {item.caEstimeProchainePeriode != null ? formaterEuros(item.caEstimeProchainePeriode) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
