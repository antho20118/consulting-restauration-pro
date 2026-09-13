import { useState } from "react";
import { creerDepot, modifierDepot } from "../services/depotService";
import type { Depot } from "../types/depot";

type Props = {
  depot: Depot | null;
  onClose: () => void;
  onSave: () => void;
};

export default function DepotForm({ depot, onClose, onSave }: Props) {
  const [nom, setNom] = useState(depot?.nom ?? "");
  const [description, setDescription] = useState(depot?.description ?? "");

  async function enregistrer() {
    const payload = { nom, description };

    try {
      if (depot) {
        await modifierDepot(depot.id, payload);
      } else {
        await creerDepot({ ...payload, societeId: 1 });
      }

      onSave();
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  return (
    <div
      style={{
        background: "white",
        padding: 20,
        borderRadius: 10,
        width: 420,
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "85vh",
        overflowY: "auto",
      }}
    >
      <h2>{depot ? "Modifier le dépôt" : "Nouveau dépôt"}</h2>

      <label>Nom</label>
      <input
        type="text"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <label>Description</label>
      <input
        type="text"
        placeholder="ex. Chambre froide, réserve sèche…"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onClose}>Annuler</button>
        <button onClick={enregistrer}>Enregistrer</button>
      </div>
    </div>
  );
}
