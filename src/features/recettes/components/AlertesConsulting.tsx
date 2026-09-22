import { useEffect, useState } from "react";
import { getAnalyseConsulting } from "../services/recetteService";

type Props = {
  recetteId: number;
};

// Branchement a minima de l'agent Consulting (voir server/routes/consulting.ts et l'audit
// fonctionnel qui a trouvé que ce endpoint, bien que fonctionnel et testé, n'était appelé nulle
// part dans l'application). N'affiche que les alertes : les indicateurs (coût, food cost...) que
// renvoie aussi cette route sont déjà affichés ailleurs sur la fiche recette à partir des mêmes
// données ; les répéter ici serait redondant. Comme SuggestionsEconomie.tsx, ne s'affiche pas du
// tout s'il n'y a rien à signaler.
export default function AlertesConsulting({ recetteId }: Props) {
  const [alertes, setAlertes] = useState<string[] | null>(null);

  useEffect(() => {
    getAnalyseConsulting(recetteId)
      .then((res) => setAlertes(res.alertes))
      .catch(() => setAlertes([]));
  }, [recetteId]);

  if (!alertes || alertes.length === 0) return null;

  return (
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
        {alertes.map((alerte) => (
          <li key={alerte}>{alerte}</li>
        ))}
      </ul>
    </div>
  );
}
