import { useEffect, useState } from "react";

import { getDocumentDetail, type DocumentFournisseurDetail } from "../../ingredients/services/listingFournisseurService";
import { obtenirUrlDocument } from "../services/documentFournisseurService";

const LIBELLE_DECISION: Record<string, { texte: string; couleur: string }> = {
  EN_ATTENTE: { texte: "En attente", couleur: "#946200" },
  VALIDEE: { texte: "Validée", couleur: "#1a7a3c" },
  REJETEE: { texte: "Rejetée", couleur: "#b00020" },
};

// Détail d'un document déjà importé : sépare visiblement niveau A (données lues), niveau B
// (rapprochement proposé) et niveau C (décision + tarif appliqué) — jamais une proposition
// affichée comme si elle était déjà une décision (voir cadrage Phase 5, §9).
export default function DocumentFournisseurDetailPanel({
  documentId,
  fournisseurId,
}: {
  documentId: number;
  fournisseurId: number;
}) {
  const [documentCharge, setDocumentCharge] = useState<DocumentFournisseurDetail | null>(null);
  const [urlApercu, setUrlApercu] = useState<string | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let urlCreee: string | null = null;
    let annule = false;

    async function charger() {
      try {
        const detail = await getDocumentDetail(documentId);
        if (annule) return;
        setDocumentCharge(detail);

        if (detail.typeMime.startsWith("image/")) {
          const url = await obtenirUrlDocument(fournisseurId, detail.cle);
          if (annule) return;
          urlCreee = url;
          setUrlApercu(url);
        }
      } catch (error) {
        if (!annule) setErreur(error instanceof Error ? error.message : "Impossible de charger ce document");
      }
    }
    charger();

    return () => {
      annule = true;
      if (urlCreee) URL.revokeObjectURL(urlCreee);
    };
  }, [documentId, fournisseurId]);

  if (erreur) return <p style={{ color: "#b00020" }}>{erreur}</p>;
  if (!documentCharge) return <p>Chargement du document…</p>;

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
      <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
        <div>
          <strong>Document original</strong>
          <div style={{ marginTop: 8 }}>
            {urlApercu ? (
              <img src={urlApercu} alt="Document original" style={{ maxWidth: 240, maxHeight: 240, borderRadius: 4 }} />
            ) : (
              <span style={{ color: "#666" }}>Aperçu non disponible pour ce type de fichier ({documentCharge.typeMime})</span>
            )}
          </div>
        </div>
        <div>
          <p><strong>Type :</strong> {documentCharge.type}</p>
          <p><strong>Statut :</strong> {documentCharge.statut}</p>
          <p><strong>Fichier :</strong> {documentCharge.nomFichierOriginal ?? "(photo)"}</p>
          {documentCharge.numero && <p><strong>Numéro :</strong> {documentCharge.numero}</p>}
          {documentCharge.montantTotal !== null && <p><strong>Montant total :</strong> {documentCharge.montantTotal} €</p>}
        </div>
      </div>

      <strong>Lignes extraites ({documentCharge.lignes.length})</strong>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {documentCharge.lignes.map((ligne) => {
          const decisionInfo = LIBELLE_DECISION[ligne.decision];
          return (
            <div key={ligne.id} style={{ border: "1px solid #eee", borderRadius: 6, padding: 10, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{ligne.designationLue}</strong>
                <span style={{ color: decisionInfo.couleur, fontWeight: 600 }}>{decisionInfo.texte}</span>
              </div>

              <div style={{ marginTop: 4, color: "#444" }}>
                Lu sur le document : {ligne.prixLu !== null ? `${ligne.prixLu} €` : "prix illisible"}
                {ligne.referenceLue ? ` — réf. ${ligne.referenceLue}` : ""}
                {ligne.conditionnementLu ? ` — ${ligne.conditionnementLu}` : ""}
                {ligne.natureLigne !== "ARTICLE" ? ` — nature : ${ligne.natureLigne}` : ""}
              </div>

              {ligne.articlePropose && (
                <div style={{ marginTop: 4, color: "#666" }}>
                  Correspondance proposée : {ligne.articlePropose.nom}
                  {ligne.confiance !== null ? ` (${(ligne.confiance * 100).toFixed(0)}%)` : ""}
                </div>
              )}
              {!ligne.articlePropose && ligne.candidatsAlternatifs && ligne.candidatsAlternatifs.length > 0 && (
                <div style={{ marginTop: 4, color: "#666" }}>
                  Plusieurs candidats proposés, aucun retenu automatiquement :{" "}
                  {ligne.candidatsAlternatifs.map((c) => c.nom).join(", ")}
                </div>
              )}

              {ligne.articleRetenu && (
                <div style={{ marginTop: 4, color: "#1a7a3c" }}>
                  Article retenu (décision humaine) : {ligne.articleRetenu.nom}
                  {ligne.tarifCreeId ? " — tarif créé" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
