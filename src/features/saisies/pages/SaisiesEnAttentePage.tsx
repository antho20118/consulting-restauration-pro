import { useState } from "react";
import toast from "react-hot-toast";
import { etatSaisie, libelleSaisie, saisiesAAbandonner, type ElementFile, type EtatSaisie } from "../../../offline/fileAttenteCore";
import { abandonnerSaisie, synchroniser } from "../../../offline/synchronisation";
import { useEnLigne } from "../../../offline/useEnLigne";
import { useFileAttente } from "../../../offline/useFileAttente";
import { listerElements } from "../../../offline/fileAttenteDb";

// Suivi des saisies faites sans réseau (productions, contrôles HACCP) et pas encore enregistrées
// sur le serveur (voir src/offline/). Elles partent d'elles-mêmes au retour du réseau ; une saisie
// que le serveur refuse (recette supprimée entre-temps, saisie de plus de 7 jours…) était jusqu'ici
// renvoyée indéfiniment sans que personne n'en voie le motif : elle est affichée ici avec ce motif,
// et peut être renvoyée après correction, ou abandonnée.

function texteEtat(etat: EtatSaisie): { texte: string; couleur: string } {
  switch (etat.etat) {
    case "refusee":
      return { texte: `⛔ Refusée : ${etat.motif}`, couleur: "#b3261e" };
    case "attend_production":
      return etat.productionRefusee
        ? { texte: "⏸ Bloqué : sa production a été refusée", couleur: "#b3261e" }
        : { texte: "⏸ Partira juste après sa production", couleur: "#946200" };
    default:
      return { texte: "📡 En attente d'envoi", couleur: "#946200" };
  }
}

function saisiLe(element: ElementFile): string {
  return new Date(element.action.saisiLe ?? element.creeLe).toLocaleString("fr-FR");
}

export default function SaisiesEnAttentePage() {
  const enLigne = useEnLigne();
  const { elements } = useFileAttente();
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  async function reessayer() {
    setEnvoiEnCours(true);
    try {
      await synchroniser();
      const restants = await listerElements();
      if (restants.length === 0) toast.success("Toutes les saisies sont enregistrées.");
      else if (restants.some((e) => e.statut === "erreur")) toast.error("Certaines saisies sont toujours refusées : voir le motif.");
    } catch {
      toast.error("Envoi impossible pour le moment. Réessaie plus tard.");
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function abandonner(element: ElementFile) {
    const controles = saisiesAAbandonner(elements, element.idLocal).length - 1;
    const suite = controles > 0 ? ` ainsi que ${controles} contrôle${controles > 1 ? "s" : ""} HACCP qui en dépend${controles > 1 ? "ent" : ""}` : "";
    if (!confirm(`Abandonner « ${libelleSaisie(element)} »${suite} ? Cette saisie ne sera jamais enregistrée.`)) return;
    const retirees = await abandonnerSaisie(element.idLocal);
    if (retirees === 0) toast("Cette saisie venait d'être envoyée : rien n'a été abandonné.");
    else toast.success(retirees > 1 ? `${retirees} saisies abandonnées.` : "Saisie abandonnée.");
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>📡 Saisies en attente</h1>
      <p style={{ color: "var(--couleur-texte-attenue)", marginTop: -8, marginBottom: 20 }}>
        Productions et contrôles HACCP saisis sans réseau, pas encore enregistrés sur le serveur. Ils
        partent d'eux-mêmes dès que le réseau revient.
      </p>

      {elements.length === 0 ? (
        <p style={{ color: "#666" }}>Aucune saisie en attente : tout est enregistré.</p>
      ) : (
        <>
          <button className="btn-primary" onClick={reessayer} disabled={!enLigne || envoiEnCours} style={{ marginBottom: 16 }}>
            {envoiEnCours ? "Envoi…" : "Réessayer maintenant"}
          </button>
          {!enLigne && <span style={{ marginLeft: 10, color: "#946200" }}>Hors ligne : envoi au retour du réseau.</span>}

          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {elements.map((element) => {
              const etat = etatSaisie(element, elements);
              const { texte, couleur } = texteEtat(etat);
              return (
                <li
                  key={element.idLocal}
                  data-testid="saisie-en-attente"
                  style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}
                >
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 600 }}>
                      {element.action.type === "production" ? "🏭 " : "🛡️ "}
                      {libelleSaisie(element)}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--couleur-texte-attenue)" }}>Saisi le {saisiLe(element)}</div>
                    <div style={{ fontSize: 13, color: couleur, marginTop: 4 }}>{texte}</div>
                    {etat.etat === "refusee" && (
                      <div style={{ fontSize: 12, color: "var(--couleur-texte-attenue)", marginTop: 2 }}>
                        Corrige la cause puis « Réessayer maintenant », ou abandonne cette saisie.
                      </div>
                    )}
                  </div>
                  <button onClick={() => abandonner(element)}>Abandonner</button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
