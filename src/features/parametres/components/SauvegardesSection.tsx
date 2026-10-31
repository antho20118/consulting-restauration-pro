import toast from "react-hot-toast";
import GenerateurClesSauvegarde from "./GenerateurClesSauvegarde";
import { useEffect, useState } from "react";
import {
  getEtatSauvegardeExterne,
  getSauvegardes,
  telechargerSauvegarde,
  type EtatSauvegardeExterne,
  type Sauvegarde,
} from "../services/sauvegardeService";

// Au-delà, la sauvegarde de la nuit aurait dû avoir lieu : signalée en retard.
const RETARD_MS = 36 * 3600_000;

// En haut : la sauvegarde automatique, chaque nuit, hors de Railway (voir
// server/utils/sauvegardeExterne/) — configurée ou non, dernière réussie, dernier échec. En
// dessous : les sauvegardes manuelles écrites sur le volume Railway depuis la console (npm run
// db:sauvegarder, voir prisma/sauvegarder.ts), téléchargeables ici.
function EtatExterne({ etat, consulteLe }: { etat: EtatSauvegardeExterne | null; consulteLe: number }) {
  if (!etat) return null;
  const style = { padding: 10, borderRadius: 8, marginBottom: 16, fontSize: 14 };
  if (etat.configuration === "absente") {
    return (
      <div style={{ ...style, background: "#fff4e5", color: "#946200" }}>
        Sauvegarde automatique hors de Railway : pas encore configurée.
      </div>
    );
  }
  if (etat.configuration === "incomplete") {
    return (
      <div style={{ ...style, background: "#fdecea", color: "#b3261e" }}>
        Sauvegarde automatique hors de Railway mal configurée : {etat.probleme}
      </div>
    );
  }
  // Juste après un démarrage du serveur, la dernière sauvegarde n'a pas encore été relue chez
  // l'hébergeur : inconnue, jamais présentée comme absente.
  if (!etat.derniereConnue && !etat.dernierEchec) {
    return <div style={{ ...style, background: "#eef2f5" }}>Vérification de la dernière sauvegarde hors de Railway…</div>;
  }
  const derniere = etat.derniereReussie ? new Date(etat.derniereReussie.le) : null;
  const enRetard = !derniere || consulteLe - derniere.getTime() > RETARD_MS;
  return (
    <div style={{ ...style, background: enRetard || etat.dernierEchec ? "#fdecea" : "#e8f5e9" }}>
      <div style={{ color: enRetard ? "#b3261e" : "#1a7a3c" }}>
        {derniere
          ? `${enRetard ? "⚠ En retard — d" : "✓ D"}ernière sauvegarde hors de Railway : ${derniere.toLocaleString("fr-FR")}`
          : etat.enCours
            ? "Première sauvegarde hors de Railway en cours…"
            : "⚠ Aucune sauvegarde hors de Railway pour l'instant"}
      </div>
      {etat.dernierEchec && (
        <div style={{ color: "#b3261e", marginTop: 4 }}>
          Échec le {new Date(etat.dernierEchec.le).toLocaleString("fr-FR")} : {etat.dernierEchec.message} (nouvel
          essai automatique — détail dans le journal des erreurs)
        </div>
      )}
    </div>
  );
}

export default function SauvegardesSection() {
  const [sauvegardes, setSauvegardes] = useState<Sauvegarde[]>([]);
  const [etatExterne, setEtatExterne] = useState<{ etat: EtatSauvegardeExterne; consulteLe: number } | null>(null);
  const [chargement, setChargement] = useState(true);

  function charger() {
    setChargement(true);
    getEtatSauvegardeExterne()
      .then((etat) => setEtatExterne({ etat, consulteLe: Date.now() }))
      .catch((error) => toast.error(error instanceof Error ? error.message : "Erreur inconnue"));
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
      <EtatExterne etat={etatExterne?.etat ?? null} consulteLe={etatExterne?.consulteLe ?? 0} />

      <p style={{ fontSize: 13, color: "var(--couleur-texte-attenue)", marginTop: 0 }}>
        Sauvegardes manuelles, générées depuis la console Railway (<code>npm run db:sauvegarder</code>) :
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

      <GenerateurClesSauvegarde />
    </div>
  );
}
