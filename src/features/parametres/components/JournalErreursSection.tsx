import toast from "react-hot-toast";
import { useEffect, useState } from "react";
import { getJournalErreurs, type EntreeJournalErreur } from "../services/journalErreurService";

// Pour diagnostiquer un incident directement dans l'appli (voir server/utils/journalErreurs.ts,
// plafond de 500 lignes auto-purgées), sans devoir naviguer dans les logs Railway — ce qu'il a
// fallu faire à la main, capture d'écran par capture d'écran, avant ce chantier.
export default function JournalErreursSection() {
  const [entrees, setEntrees] = useState<EntreeJournalErreur[]>([]);
  const [chargement, setChargement] = useState(true);
  const [ouvertes, setOuvertes] = useState<Set<number>>(new Set());

  useEffect(() => {
    // Différé d'un micro-tick (même convention que SauvegardesSection.tsx) : aucun appel setState
    // ne doit être atteignable de façon synchrone depuis le corps de l'effet lui-même (règle
    // react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      setChargement(true);
      getJournalErreurs()
        .then(setEntrees)
        .catch((error) => toast.error(error instanceof Error ? error.message : "Erreur inconnue"))
        .finally(() => setChargement(false));
    });
  }, []);

  function basculer(id: number) {
    setOuvertes((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--couleur-texte-attenue)", marginTop: 0 }}>
        Les 100 dernières erreurs survenues côté serveur ou dans l'appli — clique une ligne pour
        voir le détail technique.
      </p>

      {chargement && <p style={{ color: "#666" }}>Chargement…</p>}

      {!chargement && entrees.length === 0 && (
        <p style={{ color: "#666" }}>Aucune erreur enregistrée pour l'instant.</p>
      )}

      {entrees.map((entree) => (
        <div
          key={entree.id}
          style={{
            borderBottom: "1px solid #eee",
            paddingBottom: 8,
            marginBottom: 8,
          }}
        >
          <div
            role="button"
            onClick={() => basculer(entree.id)}
            style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 4,
                background: entree.origine === "SERVEUR" ? "#fde8e8" : "#fef3c7",
                color: entree.origine === "SERVEUR" ? "#b00020" : "#92400e",
              }}
            >
              {entree.origine}
            </span>
            <span style={{ fontSize: 12, color: "var(--couleur-texte-attenue)", minWidth: 140 }}>
              {new Date(entree.moment).toLocaleString("fr-FR")}
            </span>
            <span style={{ flex: 1, fontSize: 13 }}>{entree.message}</span>
          </div>

          {ouvertes.has(entree.id) && (
            <pre
              style={{
                marginTop: 8,
                fontSize: 11,
                background: "#f8f8f8",
                padding: 10,
                borderRadius: 6,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {[
                entree.methode && entree.route ? `${entree.methode} ${entree.route}` : entree.route,
                entree.statutHttp ? `Statut HTTP : ${entree.statutHttp}` : null,
                entree.utilisateurId ? `Utilisateur : #${entree.utilisateurId}` : null,
                entree.pile,
              ]
                .filter(Boolean)
                .join("\n")}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
