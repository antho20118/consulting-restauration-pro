import { useState } from "react";
import toast from "react-hot-toast";
import { Camera } from "lucide-react";

import { redimensionnerImage } from "../../../common/redimensionnerImage";
import { extraireTexteDePhoto } from "../../recettes/utils/ocrPhoto";
import { LigneListingPhoto } from "../../ingredients/components/ImportListingPhotoModal";
import type { LigneListingExtraite, LigneDocumentFournisseur, DocumentFournisseur, DecisionLigne } from "../../ingredients/services/listingFournisseurService";
import { validerListingPhoto } from "../../ingredients/services/listingFournisseurService";
import { analyserFactureLocal } from "../utils/analyserFactureLocal";
import { normaliserDateFacture } from "../utils/normaliserDateFacture";
import {
  ImportIANonConfigureeError,
  extraireFactureParPhoto,
  creerFacturePhoto,
  type AlerteDoublon,
} from "../services/factureFournisseurService";

type Props = {
  fournisseurId: number;
  onClose: () => void;
  onSave: () => void;
};

// Import d'une facture par photo (Phase 6), pour un fournisseur déjà déterminé par la fiche
// appelante — contrairement à ImportListingPhotoModal.tsx (lancé depuis la page Ingrédients, où le
// fournisseur reste à choisir), aucun sélecteur de fournisseur n'est nécessaire ici.
export default function ImportFacturePhotoModal({ fournisseurId, onClose, onSave }: Props) {
  const [etape, setEtape] = useState<1 | 2 | 3 | 4>(1);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [nomFichier, setNomFichier] = useState("");

  const [numero, setNumero] = useState<string | null>(null);
  const [dateDocument, setDateDocument] = useState<string | null>(null);
  const [montantTotal, setMontantTotal] = useState<number | null>(null);
  const [lignesExtraites, setLignesExtraites] = useState<LigneListingExtraite[]>([]);

  const [doublon, setDoublon] = useState<AlerteDoublon | null>(null);

  const [document, setDocumentCree] = useState<DocumentFournisseur | null>(null);
  const [lignes, setLignes] = useState<LigneDocumentFournisseur[]>([]);
  const [choix, setChoix] = useState<Record<number, number>>({});
  const [rejets, setRejets] = useState<Set<number>>(new Set());

  const [resultat, setResultat] = useState<{ valides: number; rejetees: number; refusees: string[] } | null>(null);

  async function choisirPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    try {
      setPhotoDataUrl(await redimensionnerImage(fichier, 1600));
      setNomFichier(fichier.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de traiter cette photo");
    }
  }

  async function analyser() {
    if (!photoDataUrl) return;

    setChargement(true);
    setErreur("");
    try {
      let extraction: { numero: string | null; dateDocument: string | null; montantTotal: number | null; lignes: LigneListingExtraite[] };
      try {
        extraction = await extraireFactureParPhoto(photoDataUrl);
      } catch (error) {
        if (!(error instanceof ImportIANonConfigureeError)) throw error;

        toast("IA non configurée : analyse locale utilisée (moins précise, à vérifier).", { icon: "ℹ️" });
        const texte = await extraireTexteDePhoto(photoDataUrl);
        extraction = analyserFactureLocal(texte);
      }

      if (extraction.lignes.length === 0) {
        setErreur("Aucune ligne exploitable n'a été reconnue sur cette photo.");
        return;
      }

      setNumero(extraction.numero);
      setDateDocument(normaliserDateFacture(extraction.dateDocument));
      setMontantTotal(extraction.montantTotal);
      setLignesExtraites(extraction.lignes);
      setEtape(2);
    } catch (error) {
      setErreur(error instanceof Error ? error.message : "Impossible d'analyser cette photo");
    } finally {
      setChargement(false);
    }
  }

  async function importer(confirmerDoublon?: boolean) {
    if (!photoDataUrl) return;

    setChargement(true);
    setErreur("");
    try {
      const reponse = await creerFacturePhoto({
        fournisseurId,
        photoDataUrl,
        nomFichierOriginal: nomFichier || undefined,
        lignes: lignesExtraites,
        numero,
        dateDocument,
        montantTotal,
        confirmerDoublon,
      });

      // Purement informatif (règle 4 du cadrage) : rien n'a été stocké côté serveur tant que
      // l'utilisateur n'a pas explicitement confirmé — la décision reste entièrement humaine.
      if (reponse.doublon) {
        setDoublon(reponse.doublon);
        return;
      }

      setDoublon(null);
      setDocumentCree(reponse.document);
      setLignes(reponse.lignes);
      setChoix({});
      setRejets(new Set());
      setEtape(3);
    } catch (error) {
      setErreur(error instanceof Error ? error.message : "Impossible d'importer cette facture");
    } finally {
      setChargement(false);
    }
  }

  async function appliquerDecisions() {
    if (!document) return;

    setChargement(true);
    setErreur("");
    try {
      const decisions: DecisionLigne[] = lignes
        .filter((ligne) => ligne.natureLigne === "ARTICLE")
        .map((ligne): DecisionLigne | null => {
          if (rejets.has(ligne.id)) return { ligneId: ligne.id, decision: "REJETEE" };
          const articleRetenuId = choix[ligne.id];
          if (!articleRetenuId) return null;
          return { ligneId: ligne.id, decision: "VALIDEE", articleRetenuId };
        })
        .filter((d): d is DecisionLigne => d !== null);

      if (decisions.length === 0) {
        setErreur("Choisis au moins une décision (valider ou rejeter) avant de continuer.");
        return;
      }

      const reponse = await validerListingPhoto(document.id, decisions);
      setResultat(reponse);
      setEtape(4);
      onSave();
    } catch (error) {
      setErreur(error instanceof Error ? error.message : "Impossible d'appliquer les décisions");
    } finally {
      setChargement(false);
    }
  }

  return (
    <div
      style={{
        background: "white",
        padding: 20,
        borderRadius: 10,
        width: 560,
        maxWidth: "calc(100vw - 32px)",
        boxSizing: "border-box",
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "85vh",
        overflowY: "auto",
      }}
    >
      <h2>Importer une facture fournisseur par photo</h2>

      {etape === 1 && (
        <div>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              height: 180,
              borderRadius: 8,
              border: "1px dashed #ccc",
              cursor: "pointer",
              backgroundSize: "cover",
              backgroundPosition: "center",
              color: photoDataUrl ? "white" : "#666",
              textShadow: photoDataUrl ? "0 1px 3px rgba(0,0,0,.6)" : undefined,
              backgroundImage: photoDataUrl ? `url(${photoDataUrl})` : undefined,
            }}
          >
            <Camera size={22} />
            {photoDataUrl ? "Changer la photo" : "Prendre ou choisir une photo de la facture"}
            <input type="file" accept="image/*" hidden onChange={choisirPhoto} />
          </label>

          <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
            Le document original sera conservé de façon permanente et restera consultable après
            l'import.
          </p>
        </div>
      )}

      {etape === 2 && (
        <div>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
            Vérifie les informations reconnues avant de continuer — rien n'est encore enregistré.
          </p>

          <p style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>
            Une lecture automatique peut se tromper — corrige ces champs si besoin avant de
            continuer.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12, fontSize: 13 }}>
            <label>
              Numéro
              <input
                type="text"
                value={numero ?? ""}
                onChange={(e) => setNumero(e.target.value || null)}
                placeholder="non reconnu"
                style={{ width: "100%", padding: 6, marginTop: 2 }}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                value={dateDocument ?? ""}
                onChange={(e) => setDateDocument(e.target.value || null)}
                style={{ width: "100%", padding: 6, marginTop: 2 }}
              />
            </label>
            <label>
              Montant total (€)
              <input
                type="number"
                step="0.01"
                value={montantTotal ?? ""}
                onChange={(e) => setMontantTotal(e.target.value === "" ? null : Number(e.target.value))}
                placeholder="non reconnu"
                style={{ width: "100%", padding: 6, marginTop: 2 }}
              />
            </label>
          </div>

          <p style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>{lignesExtraites.length} ligne(s) reconnue(s).</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
            {lignesExtraites.map((ligne, index) => (
              <div key={index} style={{ border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", fontSize: 13 }}>
                <strong>{ligne.designation}</strong> — {ligne.prix ?? "prix illisible"}
                {ligne.conditionnement ? ` — ${ligne.conditionnement}` : ""}
                {ligne.reference ? ` — réf. ${ligne.reference}` : ""}
              </div>
            ))}
          </div>

          {doublon && <AlerteDoublonPanel doublon={doublon} />}
        </div>
      )}

      {etape === 3 && (
        <div>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
            Pour chaque ligne, choisis l'article à rattacher (ou rejette-la). Une correspondance
            avec plusieurs candidats ou aucun candidat n'applique jamais de tarif tant que tu n'as
            pas choisi explicitement.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lignes.map((ligne) => (
              <LigneListingPhoto
                key={ligne.id}
                ligne={ligne}
                rejetee={rejets.has(ligne.id)}
                choix={choix[ligne.id] ?? null}
                onChoisir={(articleId) => setChoix((c) => ({ ...c, [ligne.id]: articleId }))}
                onRejeter={(rejetee) =>
                  setRejets((r) => {
                    const suivant = new Set(r);
                    if (rejetee) suivant.add(ligne.id);
                    else suivant.delete(ligne.id);
                    return suivant;
                  })
                }
              />
            ))}
          </div>
        </div>
      )}

      {etape === 4 && resultat && (
        <div>
          <p>Import terminé :</p>
          <ul>
            <li>{resultat.valides} tarif(s) créé(s)/mis à jour</li>
            <li>{resultat.rejetees} ligne(s) rejetée(s)</li>
          </ul>
          {resultat.refusees.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p style={{ color: "#b00020" }}>Décisions refusées :</p>
              <ul style={{ color: "#b00020" }}>
                {resultat.refusees.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {erreur && <div style={{ color: "#b00020", fontSize: 13, marginTop: 10 }}>{erreur}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
        {etape === 2 && !doublon && (
          <button
            onClick={() => {
              setEtape(1);
              setDoublon(null);
            }}
            disabled={chargement}
          >
            Retour
          </button>
        )}
        {etape !== 4 && <button onClick={onClose}>Annuler</button>}
        {etape === 1 && (
          <button onClick={analyser} disabled={chargement || !photoDataUrl}>
            {chargement ? "Analyse en cours…" : "Analyser"}
          </button>
        )}
        {etape === 2 && !doublon && (
          <button onClick={() => importer(false)} disabled={chargement}>
            {chargement ? "Import en cours…" : "Continuer"}
          </button>
        )}
        {etape === 2 && doublon && (
          <>
            <button
              onClick={() => {
                setDoublon(null);
                setEtape(1);
              }}
              disabled={chargement}
            >
              Ne pas importer
            </button>
            <button onClick={() => importer(true)} disabled={chargement}>
              {chargement ? "Import en cours…" : "Confirmer l'import quand même"}
            </button>
          </>
        )}
        {etape === 3 && (
          <button onClick={appliquerDecisions} disabled={chargement}>
            {chargement ? "Application en cours…" : "Appliquer les décisions"}
          </button>
        )}
        {etape === 4 && <button onClick={onClose}>Fermer</button>}
      </div>
    </div>
  );
}

// Distingue explicitement les deux niveaux (règle 15 du cadrage) sans jamais présenter l'un comme
// une certitude : FAIBLE reste un simple rapprochement sur le numéro, FORTE ajoute date et montant
// identiques, mais aucun des deux ne bloque ni ne décide à la place de l'utilisateur (règle 4/16).
function AlerteDoublonPanel({ doublon }: { doublon: AlerteDoublon }) {
  const estForte = doublon.niveau === "FORTE";
  return (
    <div
      style={{
        marginTop: 14,
        padding: 10,
        borderRadius: 6,
        border: `1px solid ${estForte ? "#b00020" : "#b8860b"}`,
        background: estForte ? "#fdeeee" : "#fff8e6",
        fontSize: 13,
      }}
    >
      <p style={{ fontWeight: 600, margin: 0, color: estForte ? "#b00020" : "#8a6d00" }}>
        {estForte
          ? "Correspondance forte : numéro, date et montant identiques à une facture déjà importée."
          : "Doublon potentiel : numéro identique à une facture déjà importée (date et/ou montant différents)."}
      </p>
      <p style={{ margin: "6px 0 0", color: "#555" }}>
        Ceci est une alerte purement informative — la décision d'importer quand même ou non reste la
        tienne.
      </p>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
        {doublon.correspondances.map((c) => (
          <li key={c.documentId}>
            Facture n°{c.numero} du {c.dateDocument ? new Date(c.dateDocument).toLocaleDateString("fr-FR") : "date inconnue"}
            {c.montantTotal !== null ? ` — ${c.montantTotal.toFixed(2)} €` : ""} (importée le{" "}
            {new Date(c.importeLe).toLocaleDateString("fr-FR")}) — {c.niveau === "FORTE" ? "correspondance forte" : "doublon potentiel"}
          </li>
        ))}
      </ul>
    </div>
  );
}

