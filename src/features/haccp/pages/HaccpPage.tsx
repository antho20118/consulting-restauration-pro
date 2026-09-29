import { useEffect, useState } from "react";
import { getReglesHACCP } from "../services/haccpService";
import type { RegleHACCP } from "../types/haccp";

// Bibliothèque de référence HACCP (GET /haccp/regles) : jusqu'ici accessible uniquement de façon
// indirecte, règle par règle, quand elle est détectée sur une étape de recette (voir
// RecetteDetail.tsx). Cette page l'expose pour elle-même, indépendamment de toute recette —
// consultation ou formation, sans avoir à retrouver une étape qui déclenche chaque règle.
export default function HaccpPage() {
  const [regles, setRegles] = useState<RegleHACCP[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    getReglesHACCP()
      .then(setRegles)
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur inconnue"));
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>🛡️ HACCP</h1>
      <p style={{ color: "var(--couleur-texte-attenue)", marginTop: -8, marginBottom: 20 }}>
        Bibliothèque des règles HACCP reconnues automatiquement dans le procédé d'une recette (voir
        les fiches recettes) : risque, mesure préventive, limite critique, surveillance et action
        corrective pour chaque famille, ainsi que les mots-clés qui déclenchent leur détection.
      </p>

      {erreur && <p style={{ color: "#b3261e" }}>{erreur}</p>}

      {regles && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {regles.map((regle) => (
            <div
              key={regle.code}
              style={{
                background: "#fff4e5",
                border: "1px solid #f0b429",
                borderRadius: 8,
                padding: "14px 18px",
              }}
            >
              <h3 style={{ margin: "0 0 10px" }}>⚠ {regle.nom}</h3>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "4px 12px 4px 0", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top" }}>
                        Risque
                      </td>
                      <td style={{ padding: "4px 0" }}>{regle.risque}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 12px 4px 0", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top" }}>
                        Mesure préventive
                      </td>
                      <td style={{ padding: "4px 0" }}>{regle.mesurePreventive}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 12px 4px 0", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top" }}>
                        Limite critique
                      </td>
                      <td style={{ padding: "4px 0" }}>{regle.limiteCritique}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 12px 4px 0", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top" }}>
                        Surveillance
                      </td>
                      <td style={{ padding: "4px 0" }}>{regle.surveillance}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 12px 4px 0", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top" }}>
                        Action corrective
                      </td>
                      <td style={{ padding: "4px 0" }}>{regle.actionCorrective}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 10, fontSize: 13, color: "var(--couleur-texte-attenue)" }}>
                Détection automatique sur les mots-clés :{" "}
                {regle.motsCles.map((mot) => (
                  <span
                    key={mot}
                    style={{
                      display: "inline-block",
                      background: "white",
                      border: "1px solid #f0b429",
                      borderRadius: 12,
                      padding: "2px 10px",
                      marginRight: 6,
                      marginTop: 4,
                    }}
                  >
                    {mot}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
