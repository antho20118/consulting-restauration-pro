import toast from "react-hot-toast";
import { useState } from "react";
import { creerFournisseur, modifierFournisseur } from "../services/fournisseurService";
import type { Fournisseur } from "../types/fournisseur";

type Props = {
  fournisseur: Fournisseur | null;
  onClose: () => void;
  onSave: () => void;
};

export default function FournisseurForm({ fournisseur, onClose, onSave }: Props) {
  const [nom, setNom] = useState(fournisseur?.nom ?? "");
  const [telephone, setTelephone] = useState(fournisseur?.telephone ?? "");
  const [email, setEmail] = useState(fournisseur?.email ?? "");
  const [siteWeb, setSiteWeb] = useState(fournisseur?.siteWeb ?? "");

  async function enregistrer() {
    const payload = { nom, telephone, email, siteWeb };

    try {
      if (fournisseur) {
        await modifierFournisseur(fournisseur.id, payload);
      } else {
        await creerFournisseur({ ...payload, societeId: 1 });
      }

      onSave();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
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
      <h2>{fournisseur ? "Modifier le fournisseur" : "Nouveau fournisseur"}</h2>

      <label>Nom</label>
      <input
        type="text"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <label>Téléphone</label>
      <input
        type="text"
        value={telephone}
        onChange={(e) => setTelephone(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <label>Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <label>Site web</label>
      <input
        type="text"
        placeholder="https://…"
        value={siteWeb}
        onChange={(e) => setSiteWeb(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={enregistrer}>Enregistrer</button>
      </div>
    </div>
  );
}
