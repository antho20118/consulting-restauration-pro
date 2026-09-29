import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCommandes } from "../services/commandeService";
import type { Commande, StatutCommande } from "../types/commande";

const LIBELLE_STATUT: Record<StatutCommande, { texte: string; couleur: string }> = {
  EN_ATTENTE: { texte: "En attente", couleur: "#946200" },
  RECUE: { texte: "Reçue", couleur: "#1a7a3c" },
  RECUE_PARTIELLEMENT: { texte: "Reçue partiellement", couleur: "#b8860b" },
  ANNULEE: { texte: "Annulée", couleur: "#888" },
};

// Liste des commandes fournisseurs — voir cadrage « boucle achats complète » (Phase 1 du plan
// d'action) : enregistrées depuis la page Production (proposition d'achat validée), réceptionnées
// ici pour mettre à jour le stock (voir CommandeDetailPage.tsx).
export default function CommandesPage() {
  const [commandes, setCommandes] = useState<Commande[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    getCommandes()
      .then(setCommandes)
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur inconnue"));
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>📦 Commandes fournisseurs</h1>
      <p style={{ color: "var(--couleur-texte-attenue)", marginTop: -8, marginBottom: 20 }}>
        Enregistrées depuis la proposition d'achat (page Production). Réceptionne une commande pour
        mettre à jour le stock du dépôt concerné.
      </p>

      {erreur && <p style={{ color: "#b3261e" }}>{erreur}</p>}

      {commandes && commandes.length === 0 && <p style={{ color: "#666" }}>Aucune commande pour l'instant.</p>}

      {commandes && commandes.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "8px 6px" }}>Fournisseur</th>
              <th style={{ padding: "8px 6px" }}>Dépôt</th>
              <th style={{ padding: "8px 6px" }}>Statut</th>
              <th style={{ padding: "8px 6px" }}>Créée le</th>
              <th style={{ padding: "8px 6px" }} />
            </tr>
          </thead>
          <tbody>
            {commandes.map((commande) => {
              const statutInfo = LIBELLE_STATUT[commande.statut];
              return (
                <tr key={commande.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 6px" }}>{commande.fournisseur.nom}</td>
                  <td style={{ padding: "8px 6px" }}>{commande.depot.nom}</td>
                  <td style={{ padding: "8px 6px", color: statutInfo.couleur, fontWeight: 600 }}>{statutInfo.texte}</td>
                  <td style={{ padding: "8px 6px" }}>{new Date(commande.creeLe).toLocaleDateString("fr-FR")}</td>
                  <td style={{ padding: "8px 6px" }}>
                    <Link to={`/commandes/${commande.id}`}>Voir</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
