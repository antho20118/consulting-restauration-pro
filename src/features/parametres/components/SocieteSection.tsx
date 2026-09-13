import { useEffect, useState } from "react";
import { getSociete, modifierSociete } from "../services/parametresService";
import type { Societe } from "../types/parametres";

export default function SocieteSection() {
  const [societe, setSociete] = useState<Societe | null>(null);
  const [nom, setNom] = useState("");

  useEffect(() => {
    getSociete().then((data) => {
      setSociete(data);
      setNom(data.nom);
    });
  }, []);

  async function enregistrer() {
    if (!societe || !nom.trim()) return;
    try {
      const misAJour = await modifierSociete(societe.id, nom.trim());
      setSociete(misAJour);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  if (!societe) return null;

  return (
    <div style={{ display: "flex", gap: 8, maxWidth: 400 }}>
      <input
        type="text"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        style={{ flex: 1, padding: 8 }}
      />
      <button onClick={enregistrer}>Enregistrer</button>
    </div>
  );
}
