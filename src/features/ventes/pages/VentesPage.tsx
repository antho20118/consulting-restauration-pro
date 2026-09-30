import { useEffect, useState } from "react";
import ImportVentesModal from "../components/ImportVentesModal";
import {
  getHistoriqueVentes,
  getReconciliationVentes,
  type DocumentVentesResume,
  type ReconciliationRecette,
} from "../services/venteService";

function formaterEuros(valeur: number | null): string {
  return valeur !== null ? `${valeur.toFixed(2)} €` : "—";
}

function formaterPct(valeur: number | null): string {
  return valeur !== null ? `${valeur.toFixed(1)} %` : "—";
}

// Import de ventes (export CSV/Excel d'une caisse enregistreuse/logiciel d'encaissement) et
// réconciliation food cost théorique (moteur de coût, à date) vs réel (ventes confirmées) — voir
// cadrage « rapprochement produit vendu -> recette », même principe que l'import de listings
// fournisseurs (ImportListingModal.tsx) appliqué au sens inverse (une vente plutôt qu'un achat).
export default function VentesPage() {
  const [documents, setDocuments] = useState<DocumentVentesResume[] | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationRecette[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [modalOuverte, setModalOuverte] = useState(false);

  function charger() {
    Promise.all([getHistoriqueVentes(), getReconciliationVentes()])
      .then(([docs, recon]) => {
        setDocuments(docs);
        setReconciliation(recon);
      })
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur inconnue"));
  }

  useEffect(() => {
    charger();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h1>💰 Ventes</h1>
        <button className="btn-primary" onClick={() => setModalOuverte(true)}>
          Importer des ventes
        </button>
      </div>
      <p style={{ color: "var(--couleur-texte-attenue)", marginTop: -8, marginBottom: 20 }}>
        Importe un export de ventes par produit (caisse enregistreuse/logiciel d'encaissement) pour
        comparer, recette par recette, le food cost théorique (moteur de coût, à date) et le food
        cost réel constaté sur les ventes confirmées.
      </p>

      {erreur && <p style={{ color: "#b3261e" }}>{erreur}</p>}

      <h2>Réconciliation food cost théorique / réel</h2>
      {reconciliation && reconciliation.length === 0 && (
        <p style={{ color: "#666" }}>
          Aucune vente rapprochée pour l'instant : importe un fichier de ventes pour voir la
          réconciliation.
        </p>
      )}
      {reconciliation && reconciliation.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 30 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: "8px 6px" }}>Recette</th>
                <th style={{ padding: "8px 6px" }}>Quantité vendue</th>
                <th style={{ padding: "8px 6px" }}>CA réel</th>
                <th style={{ padding: "8px 6px" }}>Coût théorique total</th>
                <th style={{ padding: "8px 6px" }}>Food cost théorique</th>
                <th style={{ padding: "8px 6px" }}>Food cost réel</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.map((r) => (
                <tr key={r.recetteId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 6px" }}>{r.recetteNom ?? `Recette #${r.recetteId}`}</td>
                  <td style={{ padding: "8px 6px" }}>{r.quantiteVendue}</td>
                  <td style={{ padding: "8px 6px" }}>
                    {formaterEuros(r.chiffreAffairesReel)}
                    {r.ventesSansPrix > 0 && (
                      <span style={{ color: "#946200", fontSize: 12 }}>
                        {" "}
                        ({r.ventesSansPrix} vente(s) sans prix)
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "8px 6px" }}>{formaterEuros(r.coutTheoriqueTotal)}</td>
                  <td style={{ padding: "8px 6px" }}>{formaterPct(r.foodCostTheoriquePct)}</td>
                  <td style={{ padding: "8px 6px" }}>{formaterPct(r.foodCostReelPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Historique des imports</h2>
      {documents && documents.length === 0 && <p style={{ color: "#666" }}>Aucun import de ventes pour l'instant.</p>}
      {documents && documents.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: "8px 6px" }}>Fichier</th>
                <th style={{ padding: "8px 6px" }}>Période</th>
                <th style={{ padding: "8px 6px" }}>Importé le</th>
                <th style={{ padding: "8px 6px" }}>Par</th>
                <th style={{ padding: "8px 6px" }}>Rapprochées</th>
                <th style={{ padding: "8px 6px" }}>Ignorées</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 6px" }}>{d.nomFichierOriginal ?? "—"}</td>
                  <td style={{ padding: "8px 6px" }}>
                    {d.periodeDebut ? new Date(d.periodeDebut).toLocaleDateString("fr-FR") : "—"}
                    {" → "}
                    {d.periodeFin ? new Date(d.periodeFin).toLocaleDateString("fr-FR") : "—"}
                  </td>
                  <td style={{ padding: "8px 6px" }}>{new Date(d.importeLe).toLocaleDateString("fr-FR")}</td>
                  <td style={{ padding: "8px 6px" }}>{d.creeParIdentifiant ?? "—"}</td>
                  <td style={{ padding: "8px 6px" }}>{d.validees}</td>
                  <td style={{ padding: "8px 6px" }}>{d.rejetees + d.enAttente}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOuverte && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <ImportVentesModal onClose={() => setModalOuverte(false)} onSave={charger} />
        </div>
      )}
    </div>
  );
}
