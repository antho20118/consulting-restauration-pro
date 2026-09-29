import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import ChampNombre from "../../../common/ChampNombre";
import { annulerCommande, getCommande, receptionnerCommande } from "../services/commandeService";
import type { Commande, StatutCommande } from "../types/commande";

const LIBELLE_STATUT: Record<StatutCommande, { texte: string; couleur: string }> = {
  EN_ATTENTE: { texte: "En attente", couleur: "#946200" },
  RECUE: { texte: "Reçue", couleur: "#1a7a3c" },
  RECUE_PARTIELLEMENT: { texte: "Reçue partiellement", couleur: "#b8860b" },
  ANNULEE: { texte: "Annulée", couleur: "#888" },
};

function formaterQuantite(quantiteBase: number, uniteBase: string): string {
  return `${quantiteBase} ${uniteBase}`;
}

// Détail d'une commande fournisseur : au statut EN_ATTENTE, permet la réception (quantités
// réellement livrées, pré-remplies avec les quantités commandées, éditables en cas de livraison
// partielle) — voir POST /commandes/:id/receptionner, qui met à jour le stock du dépôt en une
// seule transaction. Une fois traitée (reçue ou annulée), la commande reste consultable mais n'est
// plus modifiable.
export default function CommandeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const commandeId = Number(id);

  const [commande, setCommande] = useState<Commande | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [quantitesRecues, setQuantitesRecues] = useState<Record<number, number>>({});
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    getCommande(commandeId)
      .then((c) => {
        setCommande(c);
        setQuantitesRecues(Object.fromEntries(c.lignes.map((l) => [l.id, l.quantiteCommandeeBase])));
      })
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur inconnue"));
  }, [commandeId]);

  async function validerReception() {
    if (!commande) return;
    setEnCours(true);
    try {
      const lignes = commande.lignes.map((l) => ({ ligneId: l.id, quantiteRecueBase: quantitesRecues[l.id] ?? 0 }));
      const misAJour = await receptionnerCommande(commande.id, lignes);
      setCommande(misAJour);
      toast.success(
        misAJour.statut === "RECUE" ? "Commande reçue en totalité, stock mis à jour." : "Réception partielle enregistrée, stock mis à jour."
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible d'enregistrer la réception");
    } finally {
      setEnCours(false);
    }
  }

  async function annuler() {
    if (!commande) return;
    setEnCours(true);
    try {
      const misAJour = await annulerCommande(commande.id);
      setCommande(misAJour);
      toast.success("Commande annulée.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible d'annuler cette commande");
    } finally {
      setEnCours(false);
    }
  }

  if (erreur) return <p style={{ padding: 20, color: "#b3261e" }}>{erreur}</p>;
  if (!commande) return <p style={{ padding: 20 }}>Chargement…</p>;

  const statutInfo = LIBELLE_STATUT[commande.statut];
  const enAttente = commande.statut === "EN_ATTENTE";

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <Link to="/commandes">← Retour aux commandes</Link>
      </div>

      <h1>📦 Commande #{commande.id}</h1>
      <p style={{ color: "#666" }}>
        <strong>{commande.fournisseur.nom}</strong> — livraison à <strong>{commande.depot.nom}</strong>
        {" · "}
        <span style={{ color: statutInfo.couleur, fontWeight: 600 }}>{statutInfo.texte}</span>
        {" · "}créée le {new Date(commande.creeLe).toLocaleDateString("fr-FR")}
        {commande.dateReception && <> · réceptionnée le {new Date(commande.dateReception).toLocaleDateString("fr-FR")}</>}
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, marginBottom: 20 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: "8px 6px" }}>Article</th>
            <th style={{ padding: "8px 6px" }}>Conditionnement</th>
            <th style={{ padding: "8px 6px" }}>Quantité commandée</th>
            <th style={{ padding: "8px 6px" }}>Quantité reçue</th>
            <th style={{ padding: "8px 6px", textAlign: "right" }}>Prix unitaire</th>
          </tr>
        </thead>
        <tbody>
          {commande.lignes.map((ligne) => (
            <tr key={ligne.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "8px 6px" }}>{ligne.article.nom}</td>
              <td style={{ padding: "8px 6px" }}>
                {ligne.conditionnements} × {ligne.conditionnementLibelle}
              </td>
              <td style={{ padding: "8px 6px" }}>{formaterQuantite(ligne.quantiteCommandeeBase, ligne.article.uniteBase)}</td>
              <td style={{ padding: "8px 6px" }}>
                {enAttente ? (
                  <ChampNombre
                    valeur={quantitesRecues[ligne.id] ?? 0}
                    onChanger={(n) => setQuantitesRecues((q) => ({ ...q, [ligne.id]: n ?? 0 }))}
                    style={{ width: 100, padding: 6 }}
                  />
                ) : ligne.quantiteRecueBase !== null ? (
                  formaterQuantite(ligne.quantiteRecueBase, ligne.article.uniteBase)
                ) : (
                  "—"
                )}
              </td>
              <td style={{ padding: "8px 6px", textAlign: "right" }}>{ligne.prixUnitaireBase.toFixed(4)} € / {ligne.article.uniteBase}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {enAttente && (
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={annuler} disabled={enCours}>
            Annuler la commande
          </button>
          <button className="btn-primary" onClick={validerReception} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Valider la réception"}
          </button>
        </div>
      )}
    </div>
  );
}
