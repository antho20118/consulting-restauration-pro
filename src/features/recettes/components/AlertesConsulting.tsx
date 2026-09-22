import { useEffect, useState } from "react";
import { getAnalyseConsulting } from "../services/recetteService";
import type { AnalyseConsulting } from "../types/recette";

type Props = {
  recetteId: number;
};

// État explicite plutôt qu'un simple `string[] | null` : voir l'audit de l'agent Consulting,
// constat A3. Avant ce correctif, "en cours de chargement", "l'analyse a échoué" et "analysée,
// aucune alerte" produisaient tous les trois exactement le même rendu (rien) — indiscernables pour
// l'utilisateur. Seul "chargement" reste silencieux (état transitoire, pas un résultat) ; "erreur"
// et "aucune alerte" doivent désormais rester visuellement distincts l'un de l'autre.
type Etat =
  | { statut: "chargement" }
  | { statut: "erreur" }
  | { statut: "analysee"; alertes: string[]; simulation: AnalyseConsulting["simulation"] };

// Branchement a minima de l'agent Consulting (voir server/routes/consulting.ts et l'audit
// fonctionnel qui a trouvé que ce endpoint, bien que fonctionnel et testé, n'était appelé nulle
// part dans l'application). N'affiche que les alertes et la simulation de prix (coefficient
// multiplicateur) : les autres indicateurs (coût, food cost réel...) que renvoie aussi cette route
// sont déjà affichés ailleurs sur la fiche recette à partir des mêmes données ; les répéter ici
// serait redondant.
export default function AlertesConsulting({ recetteId }: Props) {
  const [etat, setEtat] = useState<Etat>({ statut: "chargement" });

  useEffect(() => {
    getAnalyseConsulting(recetteId)
      .then((res) => setEtat({ statut: "analysee", alertes: res.alertes, simulation: res.simulation }))
      .catch(() => setEtat({ statut: "erreur" }));
  }, [recetteId]);

  if (etat.statut === "chargement") return null;

  if (etat.statut === "erreur") {
    return (
      <p
        style={{
          color: "var(--couleur-texte-attenue, #888)",
          fontSize: 13,
          fontStyle: "italic",
          marginBottom: 20,
        }}
      >
        Analyse Consulting indisponible pour cette recette (erreur lors du chargement) — ceci ne
        signifie pas qu'il n'y a aucun point d'attention, seulement qu'il n'a pas pu être vérifié.
      </p>
    );
  }

  if (etat.alertes.length === 0 && !etat.simulation) return null;

  return (
    <>
      {etat.alertes.length > 0 && (
        <div
          style={{
            background: "#fff4e5",
            border: "1px solid #f0b429",
            borderRadius: 8,
            padding: 14,
            marginBottom: 20,
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 15 }}>⚠ Points d'attention</h3>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {etat.alertes.map((alerte) => (
              <li key={alerte}>{alerte}</li>
            ))}
          </ul>
        </div>
      )}

      {etat.simulation && (
        // Fond neutre (bleu/gris), volontairement différent du panneau d'alertes ambré ci-dessus :
        // ce n'est pas un problème, c'est une estimation. Le mot "estimé"/"simulé" apparaît à
        // chaque occurrence du chiffre, jamais une seule fois en tête de section, pour qu'il ne
        // soit jamais possible d'isoler le nombre de sa mise en garde (voir l'audit, constat A3).
        <div
          style={{
            background: "#eef2ff",
            border: "1px solid #a5b4fc",
            borderRadius: 8,
            padding: 14,
            marginBottom: 20,
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 15 }}>💡 Simulation (pas de prix de vente renseigné)</h3>
          <p style={{ margin: 0, fontSize: 13 }}>
            Prix de vente <strong>estimé</strong> au coefficient de la société (×{etat.simulation.coefficient}) :{" "}
            <strong>{etat.simulation.prixVenteEstimeHT.toFixed(2)} € HT</strong> — food cost{" "}
            <strong>théorique</strong> correspondant : <strong>{etat.simulation.foodCostTheoriquePct.toFixed(1)} %</strong>.
            Ceci n'est pas un prix de vente réel.
          </p>
        </div>
      )}
    </>
  );
}
