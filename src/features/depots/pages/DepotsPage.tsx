import { useEffect, useState } from "react";
import DepotsTable from "../components/DepotsTable";
import DepotForm from "../components/DepotForm";
import { getDepots, supprimerDepot } from "../services/depotService";
import type { Depot } from "../types/depot";

export default function DepotsPage() {
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotEnEdition, setDepotEnEdition] = useState<Depot | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  function chargerDepots() {
    getDepots().then(setDepots);
  }

  useEffect(() => {
    chargerDepots();
  }, []);

  function ouvrirCreation() {
    setDepotEnEdition(null);
    setFormulaireOuvert(true);
  }

  function ouvrirEdition(depot: Depot) {
    setDepotEnEdition(depot);
    setFormulaireOuvert(true);
  }

  async function supprimer(depot: Depot) {
    if (!confirm(`Supprimer le dépôt "${depot.nom}" ?`)) return;
    await supprimerDepot(depot.id);
    chargerDepots();
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>🏭 Dépôts</h1>

      <div style={{ marginBottom: 20 }}>
        <button onClick={ouvrirCreation}>+ Nouveau dépôt</button>
      </div>

      <DepotsTable depots={depots} onEdit={ouvrirEdition} onDelete={supprimer} />

      {formulaireOuvert && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            overflowY: "auto",
            padding: "40px 0",
          }}
        >
          <DepotForm
            depot={depotEnEdition}
            onClose={() => setFormulaireOuvert(false)}
            onSave={chargerDepots}
          />
        </div>
      )}
    </div>
  );
}
