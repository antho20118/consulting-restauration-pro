import { useEffect, useState } from "react";
import AlertesConsulting from "./AlertesConsulting";
import CalculateurProduction from "./CalculateurProduction";
import SuggestionsEconomie from "./SuggestionsEconomie";
import { getEvaluationHACCP } from "../services/recetteService";
import type { EtapeEvalueeHACCP, Recette } from "../types/recette";

type Props = {
  recette: Recette;
  onClose: () => void;
  onEdit: (recette: Recette) => void;
  onDelete: (recette: Recette) => void;
};

export default function RecetteDetail({ recette, onClose, onEdit, onDelete }: Props) {
  const [evaluationHACCP, setEvaluationHACCP] = useState<EtapeEvalueeHACCP[] | null>(null);

  useEffect(() => {
    getEvaluationHACCP(recette.id)
      .then((res) => setEvaluationHACCP(res.etapes))
      .catch(() => setEvaluationHACCP(null));
  }, [recette.id]);

  return (
    <div
      className="fiche-technique-impression"
      style={{
        background: "white",
        padding: 24,
        borderRadius: 10,
        width: 750,
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "90vh",
        overflowY: "auto",
      }}
    >
      <style>{`
        @media print {
          .fiche-technique-sans-impression { display: none !important; }
          .fiche-technique-apercu-overlay {
            position: static !important;
            background: none !important;
            padding: 0 !important;
            display: block !important;
          }
          .fiche-technique-impression {
            box-shadow: none !important;
            max-height: none !important;
            overflow: visible !important;
            width: auto !important;
          }
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{recette.nom}</h2>
          <div style={{ color: "#666" }}>
            {recette.categorie?.nom ?? "Sans catégorie"}
            {recette.sousCategorie ? ` · ${recette.sousCategorie.nom}` : ""} · {recette.portions}{" "}
            portion{recette.portions > 1 ? "s" : ""}
          </div>
        </div>
        {recette.photo && (
          <img
            src={recette.photo}
            alt={recette.nom}
            style={{ width: 160, height: 120, objectFit: "cover", borderRadius: 8 }}
          />
        )}
      </div>

      {recette.allergenes.length > 0 && (
        <div style={{ margin: "16px 0" }}>
          <strong>Allergènes : </strong>
          {recette.allergenes.map((allergene) => (
            <span
              key={allergene.id}
              style={{
                background: "#fdecea",
                color: "#b3261e",
                borderRadius: 12,
                padding: "3px 10px",
                fontSize: 13,
                marginRight: 6,
                display: "inline-block",
              }}
            >
              {allergene.nom}
            </span>
          ))}
        </div>
      )}

      <h3>Ingrédients</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: "6px 0" }}>Ingrédient</th>
            <th style={{ padding: "6px 0" }}>Quantité</th>
            <th style={{ padding: "6px 0", textAlign: "right" }}>Coût</th>
          </tr>
        </thead>
        <tbody>
          {recette.lignes.map((ligne) => (
            <tr key={ligne.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "6px 0" }}>{ligne.article.nom}</td>
              <td style={{ padding: "6px 0" }}>
                {ligne.quantite} {ligne.unite.symbole}
              </td>
              <td style={{ padding: "6px 0", textAlign: "right" }}>
                {ligne.coutLigne.toFixed(2)} €
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Procédé pas à pas</h3>
      {recette.etapes.length === 0 && <p style={{ color: "#888" }}>Aucune étape renseignée.</p>}
      {recette.etapes.map((etape, index) => {
        // evaluationHACCP est une suggestion automatique (mots-clés + signal humain
        // pointCritiqueHACCP, voir server/utils/haccp.ts) — jamais une preuve de conformité.
        const evaluation = evaluationHACCP?.find((e) => e.id === etape.id);
        const controleManquant = etape.pointCritiqueHACCP && evaluation?.aValider;
        const suggestionNonDeclaree = !etape.pointCritiqueHACCP && evaluation != null && evaluation.aValider;

        return (
          <div key={etape.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ fontWeight: "bold" }}>{index + 1}.</span>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{etape.description}</p>
            </div>
            {etape.pointCritiqueHACCP && (
              <div
                style={{
                  marginTop: 6,
                  marginLeft: 20,
                  background: "#fff4e5",
                  border: "1px solid #f0b429",
                  borderRadius: 6,
                  padding: "8px 12px",
                }}
              >
                <strong>⚠ Point critique HACCP</strong>
                {etape.controleHACCP && <div>{etape.controleHACCP}</div>}
                {controleManquant && (
                  <div style={{ color: "#b3261e", fontWeight: 600, marginTop: 4 }}>
                    Contrôle non documenté — précisez la limite critique respectée.
                  </div>
                )}
              </div>
            )}
            {suggestionNonDeclaree && (
              <div
                style={{
                  marginTop: 6,
                  marginLeft: 20,
                  background: "#eef2ff",
                  border: "1px solid #a5b4fc",
                  borderRadius: 6,
                  padding: "8px 12px",
                  fontSize: 13,
                }}
              >
                <strong>🔍 Point HACCP potentiel détecté</strong> (
                {evaluation!.reglesDetectees.map((r) => r.nom).join(", ")}) — vérifiez si cette étape doit
                être marquée « point critique » et son contrôle documenté.
              </div>
            )}
          </div>
        );
      })}

      {recette.instructions && (
        <>
          <h3>Notes complémentaires</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{recette.instructions}</p>
        </>
      )}

      <div
        style={{
          background: "#f4f6f8",
          borderRadius: 8,
          padding: 12,
          marginTop: 20,
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <span>Coût / portion : <strong>{recette.coutParPortion.toFixed(2)} €</strong></span>
        <span>
          Prix de vente HT :{" "}
          <strong>{recette.prixVenteHT != null ? `${recette.prixVenteHT.toFixed(2)} €` : "—"}</strong>
        </span>
        <span>
          Food cost :{" "}
          <strong>{recette.foodCostPct != null ? `${recette.foodCostPct.toFixed(1)} %` : "—"}</strong>
        </span>
      </div>

      <div className="fiche-technique-sans-impression">
        <AlertesConsulting recetteId={recette.id} />
        <SuggestionsEconomie recetteId={recette.id} />
        <CalculateurProduction recette={recette} />
      </div>

      <div
        className="fiche-technique-sans-impression"
        style={{ display: "flex", justifyContent: "space-between", gap: 10 }}
      >
        <button className="btn-danger" onClick={() => onDelete(recette)}>
          Supprimer
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose}>Fermer</button>
          <button onClick={() => window.print()}>Imprimer</button>
          <button className="btn-primary" onClick={() => onEdit(recette)}>
            Modifier
          </button>
        </div>
      </div>
    </div>
  );
}
