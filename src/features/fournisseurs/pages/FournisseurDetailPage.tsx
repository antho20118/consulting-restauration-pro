import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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
const ONGLETS: Onglet[] = ["informations", "tarifs", "listings", "factures"];

function estOnglet(valeur: string | null): valeur is Onglet {
  return valeur !== null && (ONGLETS as string[]).includes(valeur);
}

export default function FournisseurDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fournisseurId = Number(id);

  // L'onglet actif est dérivé de l'URL (?onglet=...), jamais dupliqué dans un state local séparé :
  // une seule source de vérité, pour que rechargement et navigation directe restent toujours
  // cohérents avec ce qui est affiché. Un paramètre absent ou invalide retombe sur "informations".
  const [searchParams, setSearchParams] = useSearchParams();
  const ongletParam = searchParams.get("onglet");
  const onglet: Onglet = estOnglet(ongletParam) ? ongletParam : "informations";

  function setOnglet(cible: Onglet) {
    setSearchParams(
      (params) => {
        const suivants = new URLSearchParams(params);
        suivants.set("onglet", cible);
        return suivants;
      },
      // replace plutôt que push : changer d'onglet est un changement de vue au sein d'une même
      // fiche, pas une navigation vers une nouvelle page — le bouton précédent du navigateur doit
      // faire sortir de la fiche, pas rejouer les onglets un par un.
      { replace: true },
    );
  }

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
      <style>{`
        .ffo-tab {
          padding: 10px 18px;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          color: #444;
          border-bottom: 3px solid transparent;
          border-radius: 8px 8px 0 0;
          transition: background-color .15s ease, color .15s ease;
        }
        .ffo-tab:hover { background: #f3f4f6; color: #16a085; }
        .ffo-tab.active { background: #eafaf4; color: #0f6848; font-weight: 700; border-bottom-color: #16a085; }
      `}</style>

      <button onClick={() => navigate("/fournisseurs")} style={{ marginBottom: 12 }}>
        ← Retour à la liste
      </button>
      <h1 style={{ marginBottom: 4 }}>🚚 {fournisseur.nom}</h1>
      <div style={{ color: "#666", fontSize: 14, marginBottom: 20 }}>
        {fournisseur.telephone ?? "—"} · {fournisseur.email ?? "—"} · {fournisseur.siteWeb ?? "—"}
      </div>

      <div
        style={{
          display: "flex",
          gap: 4,
          flexWrap: "wrap",
          borderBottom: "2px solid #e5e7eb",
          marginBottom: 24,
        }}
      >
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
            className={`ffo-tab${onglet === cle ? " active" : ""}`}
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
          onOuvrirDocument={(documentId, typeDocument) => {
            setDocumentOuvertId(documentId);
            setOnglet(typeDocument === "LISTING" ? "listings" : "factures");
          }}
        />
      )}

      {onglet === "listings" && (
        <div>
          <div
            style={{
              background: "#eef6fb",
              border: "1px solid #bfdcee",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 13,
              color: "#22506b",
            }}
          >
            ℹ️ Les listings s'importent depuis la page <strong>Base ingrédients</strong>.
          </div>
          <OngletDocuments
            documents={listings}
            fournisseurId={fournisseurId}
            documentOuvertId={documentOuvertId}
            onOuvrir={setDocumentOuvertId}
            messageVide="Aucun listing importé pour l'instant."
          />
        </div>
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
  onOuvrirDocument: (documentId: number, typeDocument: "LISTING" | "FACTURE") => void;
}) {
  if (tarifs.length === 0) {
    return <p style={{ color: "#666" }}>Aucun tarif enregistré pour ce fournisseur.</p>;
  }

  const actuels = tarifs.filter((t) => t.actif);
  const historiques = tarifs.filter((t) => !t.actif);

  return (
    <div>
      <section>
      <div style={{ background: "#f8f9fa", borderRadius: 8, padding: "8px 14px", marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>Tarifs actuels</h3>
      </div>
      {actuels.length === 0 ? (
        <p style={{ color: "#666", fontSize: 13 }}>
          Aucun tarif actuellement actif chez ce fournisseur (un tarif plus récent chez un autre
          fournisseur peut avoir clôturé le dernier tarif actif d'un article — voir l'historique
          ci-dessous).
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
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
                          onClick={() =>
                            onOuvrirDocument(
                              tarif.ligneDocumentSource!.document.id,
                              tarif.ligneDocumentSource!.document.type,
                            )
                          }
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
        </div>
      )}
      </section>

      <section style={{ marginTop: 24 }}>
      <div style={{ background: "#f8f9fa", borderRadius: 8, padding: "8px 14px", marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>Historique</h3>
      </div>
      {historiques.length === 0 ? (
        <p style={{ color: "#666", fontSize: 13 }}>Aucun tarif clôturé pour ce fournisseur.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
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
                        onClick={() =>
                          onOuvrirDocument(
                            tarif.ligneDocumentSource!.document.id,
                            tarif.ligneDocumentSource!.document.type,
                          )
                        }
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
        </div>
      )}
      </section>
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
  const panneauRef = useRef<HTMLDivElement>(null);

  // Sur une longue liste, le panneau ouvert apparaît sous tout le tableau : sans ce défilement
  // automatique, il faudrait faire défiler manuellement au-delà des lignes restantes pour le voir.
  useEffect(() => {
    if (documentOuvertId !== null) {
      panneauRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [documentOuvertId]);

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
        <div ref={panneauRef} style={{ scrollMarginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button onClick={() => onOuvrir(null)}>Fermer le document</button>
          </div>
          <DocumentFournisseurDetailPanel documentId={documentOuvertId} fournisseurId={fournisseurId} />
        </div>
      )}
    </div>
  );
}
