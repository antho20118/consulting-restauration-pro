import toast from "react-hot-toast";
import { useEffect, useState } from "react";
import ChampNombre from "../../../common/ChampNombre";
import { getSociete, modifierSociete } from "../services/parametresService";
import type { Societe } from "../types/parametres";

export default function SocieteSection() {
  const [societe, setSociete] = useState<Societe | null>(null);
  const [nom, setNom] = useState("");
  // 0 représente "non configuré", comme ailleurs dans l'app (articleId, uniteId...) — converti en
  // null à l'enregistrement, jamais envoyé tel quel (le serveur refuse un coefficient <= 0).
  const [coefficient, setCoefficient] = useState(0);

  useEffect(() => {
    getSociete().then((data) => {
      setSociete(data);
      setNom(data.nom);
      setCoefficient(data.coefficientMultiplicateur ?? 0);
    });
  }, []);

  async function enregistrer() {
    if (!societe || !nom.trim()) return;
    try {
      const misAJour = await modifierSociete(societe.id, nom.trim(), coefficient > 0 ? coefficient : null);
      setSociete(misAJour);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  if (!societe) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 420 }}>
      <div>
        <label>Nom</label>
        <input
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
        />
      </div>

      <div>
        <label>Coefficient multiplicateur (prix de vente = coût matière × coefficient)</label>
        <ChampNombre
          valeur={coefficient}
          onChanger={(n) => setCoefficient(n ?? 0)}
          placeholder="ex. 3 (laisser à 0 pour désactiver)"
          style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
        />
        <p style={{ fontSize: 12, color: "#888", marginTop: 4, marginBottom: 0 }}>
          Utilisé uniquement pour simuler un prix de vente et un food cost théorique sur les
          recettes sans prix de vente réel (voir la fiche recette). Laisser à 0 pour désactiver
          cette simulation — aucune valeur n'est imposée par défaut.
        </p>
      </div>

      <button className="btn-primary" onClick={enregistrer} style={{ alignSelf: "flex-start" }}>
        Enregistrer
      </button>
    </div>
  );
}
