import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import AlertesConsulting from "./AlertesConsulting";
import SuggestionsEconomie from "./SuggestionsEconomie";
import { getEvaluationHACCP, telechargerFichePdf } from "../services/recetteService";
import type { EtapeEvalueeHACCP, Recette, RegleHACCP } from "../types/recette";

type Props = {
  recette: Recette;
  onClose: () => void;
  onEdit: (recette: Recette) => void;
  onDelete: (recette: Recette) => void;
};

// Le serveur renvoie déjà la règle HACCP complète (voir server/utils/haccp.ts) pour chaque étape
// détectée par mots-clés — jusqu'ici seul le nom de la règle était affiché, le reste (risque,
// mesure préventive, limite critique, surveillance, action corrective) était reçu puis jeté.
function DetailReglesHACCP({ regles }: { regles: RegleHACCP[] }) {
  if (regles.length === 0) return null;

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
      {regles.map((regle) => (
        <div key={regle.code} style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{regle.nom}</div>
          <div>
            <strong>Risque :</strong> {regle.risque}
          </div>
          <div>
            <strong>Mesure préventive :</strong> {regle.mesurePreventive}
          </div>
          <div>
            <strong>Limite critique :</strong> {regle.limiteCritique}
          </div>
          <div>
            <strong>Surveillance :</strong> {regle.surveillance}
          </div>
          <div>
            <strong>Action corrective :</strong> {regle.actionCorrective}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RecetteDetail({ recette, onClose, onEdit, onDelete }: Props) {
  const [evaluationHACCP, setEvaluationHACCP] = useState<EtapeEvalueeHACCP[] | null>(null);
  const [telechargementEnCours, setTelechargementEnCours] = useState(false);

  useEffect(() => {
    getEvaluationHACCP(recette.id)
      .then((res) => setEvaluationHACCP(res.etapes))
      .catch(() => setEvaluationHACCP(null));
  }, [recette.id]);

  // Déclenche un téléchargement de fichier classique (lien temporaire cliqué par programme) —
  // aucune bibliothèque dédiée nécessaire pour un blob déjà reçu du serveur.
  async function telechargerPdf() {
    setTelechargementEnCours(true);
    try {
      const blob = await telechargerFichePdf(recette.id);
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = `fiche-${recette.nom.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
      lien.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setTelechargementEnCours(false);
    }
  }

  // Le reste de la page (barre latérale, autres recettes de la liste) reste dans le DOM derrière
  // ce pop-up : sans ce marqueur, il apparaissait aussi à l'impression puisque le CSS @media print
  // ci-dessous ne masquait que le contenu interne du pop-up, jamais la page sous-jacente.
  useEffect(() => {
    document.body.classList.add("fiche-technique-ouverte");
    return () => document.body.classList.remove("fiche-technique-ouverte");
  }, []);

  return (
    <div
      className="fiche-technique-impression"
      style={{
        background: "white",
        padding: 24,
        borderRadius: 10,
        width: 750,
        maxWidth: "calc(100vw - 32px)",
        boxSizing: "border-box",
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "90vh",
        overflowY: "auto",
      }}
    >
      <style>{`
        @media print {
          body.fiche-technique-ouverte > *:not(.fiche-technique-apercu-overlay) { display: none !important; }
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

      <h3>Valeurs nutritionnelles (par portion)</h3>
      {recette.nutritionIncomplete && (
        <p style={{ color: "#b3261e", fontSize: 13, marginTop: -8 }}>
          ⚠ Approximation — au moins un ingrédient n'a pas (ou pas entièrement) de valeurs
          nutritionnelles saisies.
        </p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "6px 16px",
          marginBottom: 20,
          fontSize: 14,
        }}
      >
        <span>Énergie : <strong>{recette.valeursNutritionnelles.energie.toFixed(0)} kcal</strong></span>
        <span>Protéines : <strong>{recette.valeursNutritionnelles.proteines.toFixed(1)} g</strong></span>
        <span>Glucides : <strong>{recette.valeursNutritionnelles.glucides.toFixed(1)} g</strong></span>
        <span>dont sucres : <strong>{recette.valeursNutritionnelles.sucres.toFixed(1)} g</strong></span>
        <span>Lipides : <strong>{recette.valeursNutritionnelles.lipides.toFixed(1)} g</strong></span>
        <span>
          dont acides gras saturés :{" "}
          <strong>{recette.valeursNutritionnelles.acidesGrasSatures.toFixed(1)} g</strong>
        </span>
        <span>Fibres : <strong>{recette.valeursNutritionnelles.fibres.toFixed(1)} g</strong></span>
        <span>Sel : <strong>{recette.valeursNutritionnelles.sel.toFixed(2)} g</strong></span>
      </div>

      <h3>Ingrédients</h3>
      <div style={{ overflowX: "auto" }}>
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
      </div>

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
                {evaluation && evaluation.reglesDetectees.length > 0 && (
                  <DetailReglesHACCP regles={evaluation.reglesDetectees} />
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
                <strong>🔍 Point HACCP potentiel détecté</strong> — vérifiez si cette étape doit être
                marquée « point critique » et son contrôle documenté.
                <DetailReglesHACCP regles={evaluation!.reglesDetectees} />
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
          <button onClick={telechargerPdf} disabled={telechargementEnCours}>
            {telechargementEnCours ? "Génération…" : "📄 Télécharger en PDF"}
          </button>
          <Link
            to={`/production/${recette.id}`}
            className="btn-primary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "8px 14px",
              borderRadius: "var(--rayon-petit)",
              textDecoration: "none",
            }}
          >
            🏭 Planifier une production
          </Link>
          <button className="btn-primary" onClick={() => onEdit(recette)}>
            Modifier
          </button>
        </div>
      </div>
    </div>
  );
}
