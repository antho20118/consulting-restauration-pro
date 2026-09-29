import toast from "react-hot-toast";
import { useEffect, useState } from "react";
import { getSauvegardes, telechargerSauvegarde, type Sauvegarde } from "../services/sauvegardeService";

// Solution provisoire en attendant les sauvegardes automatiques du plan Railway Pro : la sauvegarde
// elle-même se lance depuis la console Railway (npm run db:sauvegarder, voir prisma/sauvegarder.ts)
// — cette section ne fait que lister ce qui existe déjà sur le volume et permettre de le
// télécharger, pour le stocker ailleurs que sur Railway.
export default function SauvegardesSection() {
  const [sauvegardes, setSauvegardes] = useState<Sauvegarde[]>([]);
  const [chargement, setChargement] = useState(true);

  function charger() {
    setChargement(true);
    getSauvegardes()
      .then(setSauvegardes)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Erreur inconnue"))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    // Différé d'un micro-tick (même convention que FournisseurDetailPage.tsx) : aucun appel
    // setState ne doit être atteignable de façon synchrone depuis le corps de l'effet lui-même
    // (règle react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => charger());
  }, []);

  async function telecharger(nom: string) {
    try {
      await telechargerSauvegarde(nom);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  function formaterTaille(octets: number): string {
    if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(0)} Ko`;
    return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--couleur-texte-attenue)", marginTop: 0 }}>
        Générées manuellement depuis la console Railway (<code>npm run db:sauvegarder</code>) —
        télécharge-les régulièrement pour les conserver ailleurs que sur Railway.
      </p>

      {chargement && <p style={{ color: "#666" }}>Chargement…</p>}

      {!chargement && sauvegardes.length === 0 && (
        <p style={{ color: "#666" }}>Aucune sauvegarde pour l'instant.</p>
      )}

      {sauvegardes.map((sauvegarde) => (
        <div
          key={sauvegarde.nom}
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
        >
          <div style={{ flex: 1 }}>
            <div>{new Date(sauvegarde.creeLe).toLocaleString("fr-FR")}</div>
            <div style={{ fontSize: 12, color: "var(--couleur-texte-attenue)" }}>
              {formaterTaille(sauvegarde.tailleOctets)}
            </div>
          </div>
          <button className="btn-primary" onClick={() => telecharger(sauvegarde.nom)}>
            Télécharger
          </button>
        </div>
      ))}
    </div>
  );
}
