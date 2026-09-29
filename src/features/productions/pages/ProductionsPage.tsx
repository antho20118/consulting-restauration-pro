import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getProductions } from "../services/productionService";
import type { Production } from "../types/production";

// Historique des productions réellement enregistrées — voir cadrage « Phase 2 : traçabilité HACCP
// datée » : chaque ligne est un lot réel (recette + date + quantité), jamais une simulation (la
// planification, elle, reste calculée à la volée sans être enregistrée, voir
// ProductionPlanifierPage). La colonne HACCP résume, pour la recette de ce lot au moment de la
// consultation, combien de ses points critiques ont déjà reçu au moins un contrôle daté.
export default function ProductionsPage() {
  const [productions, setProductions] = useState<Production[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    getProductions()
      .then(setProductions)
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur inconnue"));
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>📋 Traçabilité HACCP</h1>
      <p style={{ color: "var(--couleur-texte-attenue)", marginTop: -8, marginBottom: 20 }}>
        Historique des productions réellement enregistrées, avec leurs contrôles HACCP datés.
        S'enregistre depuis l'écran de planification d'une recette (page Production).
      </p>

      {erreur && <p style={{ color: "#b3261e" }}>{erreur}</p>}

      {productions && productions.length === 0 && <p style={{ color: "#666" }}>Aucune production enregistrée pour l'instant.</p>}

      {productions && productions.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: "8px 6px" }}>Recette</th>
                <th style={{ padding: "8px 6px" }}>Date</th>
                <th style={{ padding: "8px 6px" }}>Quantité</th>
                <th style={{ padding: "8px 6px" }}>Dépôt</th>
                <th style={{ padding: "8px 6px" }}>HACCP</th>
                <th style={{ padding: "8px 6px" }} />
              </tr>
            </thead>
            <tbody>
              {productions.map((production) => {
                const total = production.pointsCritiquesTotal ?? 0;
                const controles = production.pointsCritiquesControles ?? 0;
                const complet = total > 0 && controles >= total;
                return (
                  <tr key={production.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 6px" }}>{production.recette.nom}</td>
                    <td style={{ padding: "8px 6px" }}>{new Date(production.dateProduction).toLocaleString("fr-FR")}</td>
                    <td style={{ padding: "8px 6px" }}>
                      {production.portionsProduites.toFixed(0)} portion(s) · {(production.poidsFiniProduitG / 1000).toFixed(2)} kg
                    </td>
                    <td style={{ padding: "8px 6px" }}>{production.depot?.nom ?? "—"}</td>
                    <td style={{ padding: "8px 6px" }}>
                      {total === 0 ? (
                        <span style={{ color: "#666" }}>Aucun point critique</span>
                      ) : (
                        <span style={{ color: complet ? "#1a7a3c" : "#946200", fontWeight: 600 }}>
                          {controles}/{total} contrôlé(s)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      <Link to={`/productions/${production.id}`}>Voir</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
