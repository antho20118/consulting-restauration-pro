import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import {
  getFournisseur,
  getTarifsFournisseur,
  getDocumentsFournisseur,
  type TarifFournisseur,
  type DocumentFournisseurResume,
} from "../services/fournisseurService";
import type { Fournisseur } from "../types/fournisseur";
import FournisseurForm from "../components/FournisseurForm";
import DocumentFournisseurDetailPanel from "../components/DocumentFournisseurDetailPanel";
import ImportFacturePhotoModal from "../components/ImportFacturePhotoModal";

type Onglet = "informations" | "tarifs" | "listings" | "factures";

export default function FournisseurDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fournisseurId = Number(id);

  const [onglet, setOnglet] = useState<Onglet>("informations");
  const [fournisseur, setFournisseur] = useState<Fournisseur | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  const [tarifs, setTarifs] = useState<TarifFournisseur[]>([]);
  const [documents, setDocuments] = useState<DocumentFournisseurResume[]>([]);
  const [documentOuvertId, setDocumentOuvertId] = useState<number | null>(null);
  const [importFactureOuvert, setImportFactureOuvert] = useState(false);

  async function charger() {
    if (!Number.isInteger(fournisseurId) || fournisseurId <= 0) {
      setErreur("Identifiant fournisseur invalide.");
      setChargement(false);
      return;
    }
    setChargement(true);
    try {
      const [f, t, d] = await Promise.all([
        getFournisseur(fournisseurId),
        getTarifsFournisseur(fournisseurId),
        getDocumentsFournisseur(fournisseurId),
      ]);
      setFournisseur(f);
      setTarifs(t);
      setDocuments(d);
      setErreur("");
    } catch (error) {
      setErreur(error instanceof Error ? error.message : "Impossible de charger cette fiche fournisseur");
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    // Différé d'un micro-tick (Promise.resolve().then) : aucun appel setState ne doit être
    // atteignable de façon synchrone depuis le corps de l'effet lui-même (règle
    // react-hooks/set-state-in-effect), y compris ceux de charger() avant son premier await.
    void Promise.resolve().then(() => charger());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fournisseurId]);

  if (chargement) return <div style={{ padding: 20 }}>Chargement…</div>;

  if (erreur && !fournisseur) {
    return (
      <div style={{ padding: 20 }}>
        <p style={{ color: "#b00020" }}>{erreur}</p>
        <button onClick={() => navigate("/fournisseurs")}>Retour à la liste</button>
      </div>
    );
  }
  if (!fournisseur) return null;

  const listings = documents.filter((d) => d.type === "LISTING");
  const factures = documents.filter((d) => d.type === "FACTURE");

  return (
    <div style={{ padding: 20 }}>
      <button onClick={() => navigate("/fournisseurs")} style={{ marginBottom: 12 }}>
        ← Retour à la liste
      </button>
      <h1>🚚 {fournisseur.nom}</h1>

      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid #ddd", marginBottom: 20 }}>
        {(
          [
            ["informations", "Informations"],
            ["tarifs", "Articles / Tarifs"],
            ["listings", "Listings"],
            ["factures", "Factures"],
          ] as [Onglet, string][]
        ).map(([cle, label]) => (
          <button
            key={cle}
            onClick={() => setOnglet(cle)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderBottom: onglet === cle ? "3px solid #16a085" : "3px solid transparent",
              background: "none",
              fontWeight: onglet === cle ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {onglet === "informations" && (
        <div>
          <p><strong>Téléphone :</strong> {fournisseur.telephone ?? "—"}</p>
          <p><strong>Email :</strong> {fournisseur.email ?? "—"}</p>
          <p><strong>Site web :</strong> {fournisseur.siteWeb ?? "—"}</p>
          <button onClick={() => setFormulaireOuvert(true)}>Modifier</button>
        </div>
      )}

      {onglet === "tarifs" && (
        <TableauTarifs
          tarifs={tarifs}
          onOuvrirDocument={(documentId) => {
            setDocumentOuvertId(documentId);
            setOnglet("listings");
          }}
        />
      )}

      {onglet === "listings" && (
        <OngletDocuments
          documents={listings}
          fournisseurId={fournisseurId}
          documentOuvertId={documentOuvertId}
          onOuvrir={setDocumentOuvertId}
          messageVide="Aucun listing importé pour l'instant."
        />
      )}

      {onglet === "factures" && (
        <div>
          <button onClick={() => setImportFactureOuvert(true)} style={{ marginBottom: 12 }}>
            Importer une facture par photo
          </button>
          <OngletDocuments
            documents={factures}
            fournisseurId={fournisseurId}
            documentOuvertId={documentOuvertId}
            onOuvrir={setDocumentOuvertId}
            messageVide="Aucune facture importée pour l'instant."
          />
        </div>
      )}

      {formulaireOuvert && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            overflowY: "auto",
            padding: "40px 0",
          }}
        >
          <FournisseurForm
            fournisseur={fournisseur}
            onClose={() => setFormulaireOuvert(false)}
            onSave={() => {
              charger();
              toast.success("Fournisseur modifié");
            }}
          />
        </div>
      )}

      {importFactureOuvert && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            overflowY: "auto",
            padding: "40px 0",
          }}
        >
          <ImportFacturePhotoModal
            fournisseurId={fournisseurId}
            onClose={() => setImportFactureOuvert(false)}
            onSave={() => {
              charger();
              toast.success("Facture importée");
            }}
          />
        </div>
      )}
    </div>
  );
}

// Libellé de la source d'un tarif, dérivé uniquement de DocumentFournisseur.type (jamais deviné) —
// null si le tarif n'a aucune source documentaire (créé manuellement, ou antérieur au chantier
// listings/factures, voir TarifArticle.ligneDocumentSource dans le schéma).
function libelleSourceTarif(tarif: TarifFournisseur): "Listing" | "Facture" | null {
  if (!tarif.ligneDocumentSource) return null;
  return tarif.ligneDocumentSource.document.type === "LISTING" ? "Listing" : "Facture";
}

// Onglet "Articles / Tarifs" (Phase 7) : deux sections distinctes plutôt qu'une table unique — un
// article peut n'avoir aucun tarif "actuel" chez CE fournisseur si un import plus récent chez un
// AUTRE fournisseur a clôturé le tarif actif de cet article (TarifArticle.actif est géré au niveau
// Article, jamais Article+Fournisseur — comportement réel du moteur de clôture, voir
// server/routes/listingsFournisseur.ts et articles.ts, non modifié par cette phase et non traité ici
// comme une anomalie). Ceci est donc affiché comme un état vide normal, jamais une erreur.
function TableauTarifs({
  tarifs,
  onOuvrirDocument,
}: {
  tarifs: TarifFournisseur[];
  onOuvrirDocument: (documentId: number) => void;
}) {
  if (tarifs.length === 0) {
    return <p style={{ color: "#666" }}>Aucun tarif enregistré pour ce fournisseur.</p>;
  }

  const actuels = tarifs.filter((t) => t.actif);
  const historiques = tarifs.filter((t) => !t.actif);

  return (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Tarifs actuels</h3>
      {actuels.length === 0 ? (
        <p style={{ color: "#666", fontSize: 13 }}>
          Aucun tarif actuellement actif chez ce fournisseur (un tarif plus récent chez un autre
          fournisseur peut avoir clôturé le dernier tarif actif d'un article — voir l'historique
          ci-dessous).
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th style={{ padding: 8 }}>Article</th>
              <th style={{ padding: 8 }}>Référence</th>
              <th style={{ padding: 8 }}>Prix HT</th>
              <th style={{ padding: 8 }}>Unité</th>
              <th style={{ padding: 8 }}>Conditionnement</th>
              <th style={{ padding: 8 }}>Depuis le</th>
              <th style={{ padding: 8 }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {actuels.map((tarif) => {
              const source = libelleSourceTarif(tarif);
              return (
                <tr key={tarif.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: 8 }}>{tarif.article.nom}</td>
                  <td style={{ padding: 8 }}>{tarif.article.reference ?? "—"}</td>
                  <td style={{ padding: 8 }}>{tarif.prixHT.toFixed(4)} €</td>
                  <td style={{ padding: 8 }}>{tarif.unite.symbole}</td>
                  <td style={{ padding: 8 }}>{tarif.conditionnement.nom}</td>
                  <td style={{ padding: 8 }}>{new Date(tarif.dateDebut).toLocaleDateString("fr-FR")}</td>
                  <td style={{ padding: 8 }}>
                    {source ? (
                      <>
                        {source} —{" "}
                        <button
                          onClick={() => onOuvrirDocument(tarif.ligneDocumentSource!.document.id)}
                          style={{ fontSize: 12 }}
                        >
                          Voir le document
                        </button>
                      </>
                    ) : (
                      <span style={{ color: "#999", fontStyle: "italic" }}>Source documentaire non disponible</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Historique</h3>
      {historiques.length === 0 ? (
        <p style={{ color: "#666", fontSize: 13 }}>Aucun tarif clôturé pour ce fournisseur.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th style={{ padding: 8 }}>Article</th>
              <th style={{ padding: 8 }}>Référence</th>
              <th style={{ padding: 8 }}>Prix HT</th>
              <th style={{ padding: 8 }}>Unité</th>
              <th style={{ padding: 8 }}>Conditionnement</th>
              <th style={{ padding: 8 }}>Du</th>
              <th style={{ padding: 8 }}>Au</th>
              <th style={{ padding: 8 }}>Source</th>
              <th style={{ padding: 8 }}>Document</th>
            </tr>
          </thead>
          <tbody>
            {historiques.map((tarif) => {
              const source = libelleSourceTarif(tarif);
              return (
                <tr key={tarif.id} style={{ borderBottom: "1px solid #eee", opacity: 0.75 }}>
                  <td style={{ padding: 8 }}>{tarif.article.nom}</td>
                  <td style={{ padding: 8 }}>{tarif.article.reference ?? "—"}</td>
                  <td style={{ padding: 8 }}>{tarif.prixHT.toFixed(4)} €</td>
                  <td style={{ padding: 8 }}>{tarif.unite.symbole}</td>
                  <td style={{ padding: 8 }}>{tarif.conditionnement.nom}</td>
                  <td style={{ padding: 8 }}>{new Date(tarif.dateDebut).toLocaleDateString("fr-FR")}</td>
                  <td style={{ padding: 8 }}>{tarif.dateFin ? new Date(tarif.dateFin).toLocaleDateString("fr-FR") : "—"}</td>
                  <td style={{ padding: 8 }}>{source ?? "—"}</td>
                  <td style={{ padding: 8 }}>
                    {tarif.ligneDocumentSource ? (
                      <button
                        onClick={() => onOuvrirDocument(tarif.ligneDocumentSource!.document.id)}
                        style={{ fontSize: 12 }}
                      >
                        Voir le document
                      </button>
                    ) : (
                      <span style={{ color: "#999", fontStyle: "italic" }}>Source documentaire non disponible</span>
                    )}
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

function OngletDocuments({
  documents,
  fournisseurId,
  documentOuvertId,
  onOuvrir,
  messageVide,
}: {
  documents: DocumentFournisseurResume[];
  fournisseurId: number;
  documentOuvertId: number | null;
  onOuvrir: (id: number | null) => void;
  messageVide: string;
}) {
  if (documents.length === 0) {
    return <p style={{ color: "#666" }}>{messageVide}</p>;
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 16 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Date d'import</th>
            <th style={{ padding: 8 }}>Fichier</th>
            <th style={{ padding: 8 }}>Statut</th>
            <th style={{ padding: 8 }}>Lignes</th>
            <th style={{ padding: 8 }}></th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{new Date(doc.importeLe).toLocaleString("fr-FR")}</td>
              <td style={{ padding: 8 }}>{doc.nomFichierOriginal ?? "(photo)"}</td>
              <td style={{ padding: 8 }}>{doc.statut}</td>
              <td style={{ padding: 8 }}>{doc._count.lignes}</td>
              <td style={{ padding: 8 }}>
                <button onClick={() => onOuvrir(documentOuvertId === doc.id ? null : doc.id)}>
                  {documentOuvertId === doc.id ? "Fermer" : "Ouvrir"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {documentOuvertId !== null && (
        <DocumentFournisseurDetailPanel documentId={documentOuvertId} fournisseurId={fournisseurId} />
      )}
    </div>
  );
}
