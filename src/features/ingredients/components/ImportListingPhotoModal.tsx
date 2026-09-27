import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Camera } from "lucide-react";

import { redimensionnerImage } from "../../../common/redimensionnerImage";
import { extraireTexteDePhoto } from "../../recettes/utils/ocrPhoto";
import { getFournisseurs } from "../../fournisseurs/services/fournisseurService";
import type { Fournisseur } from "../../fournisseurs/types/fournisseur";
import { analyserListingLocal } from "../utils/analyseListingLocal";
import {
  ImportIANonConfigureeError,
  extraireListingParPhoto,
  creerListingPhoto,
  validerListingPhoto,
  type LigneListingExtraite,
  type LigneDocumentFournisseur,
  type DocumentFournisseur,
  type DecisionLigne,
} from "../services/listingFournisseurService";

type Props = {
  onClose: () => void;
  onSave: () => void;
};

const LIBELLE_MOTIF: Record<string, string> = {
  REFERENCE_FOURNISSEUR: "Référence identique",
  CODE_ARTICLE: "Code article",
  ALIAS: "Correspondance déjà mémorisée",
  DESIGNATION_EXACTE: "Désignation identique",
  DESIGNATION_APPROXIMATIVE: "Désignation proche (à confirmer)",
};

const LIBELLE_NATURE: Record<string, string> = {
  FRAIS_LIVRAISON: "Frais de livraison — jamais transformé en tarif",
  AVOIR: "Avoir — jamais transformé en tarif",
  REMISE: "Remise — jamais transformée en tarif",
  NON_ALIMENTAIRE: "Non alimentaire — jamais transformé en tarif",
};

export default function ImportListingPhotoModal({ onClose, onSave }: Props) {
  const [etape, setEtape] = useState<1 | 2 | 3 | 4>(1);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [fournisseurId, setFournisseurId] = useState(0);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [nomFichier, setNomFichier] = useState("");

  const [lignesExtraites, setLignesExtraites] = useState<LigneListingExtraite[]>([]);
  const [document, setDocumentCree] = useState<DocumentFournisseur | null>(null);
  const [lignes, setLignes] = useState<LigneDocumentFournisseur[]>([]);
  // ligneId -> articleId choisi par l'utilisateur pour une ligne à candidat(s) : jamais retenue
  // par défaut, y compris pour un candidat unique — une proposition n'est jamais une décision.
  const [choix, setChoix] = useState<Record<number, number>>({});
  const [rejets, setRejets] = useState<Set<number>>(new Set());

  const [resultat, setResultat] = useState<{ valides: number; rejetees: number; refusees: string[] } | null>(null);

  useEffect(() => {
    getFournisseurs().then((liste) => {
      setFournisseurs(liste);
      if (liste.length > 0) setFournisseurId(liste[0].id);
    });
  }, []);

  async function choisirPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    try {
      // Largeur généreuse : un listing photographié comporte souvent du texte petit et dense.
      setPhotoDataUrl(await redimensionnerImage(fichier, 1600));
      setNomFichier(fichier.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de traiter cette photo");
    }
  }

  async function analyser() {
    if (!photoDataUrl || !fournisseurId) return;

    setChargement(true);
    setErreur("");
    try {
      let lignesRecues: LigneListingExtraite[];
      try {
        const reponse = await extraireListingParPhoto(photoDataUrl);
        lignesRecues = reponse.lignes;
      } catch (error) {
        if (!(error instanceof ImportIANonConfigureeError)) throw error;

        toast(
          "IA non configurée : analyse locale utilisée (moins précise, à vérifier).",
          { icon: "ℹ️" }
        );
        const texte = await extraireTexteDePhoto(photoDataUrl);
        lignesRecues = analyserListingLocal(texte);
      }

      if (lignesRecues.length === 0) {
        setErreur("Aucune ligne exploitable n'a été reconnue sur cette photo.");
        return;
      }

      setLignesExtraites(lignesRecues);
      setEtape(2);
    } catch (error) {
      setErreur(error instanceof Error ? error.message : "Impossible d'analyser cette photo");
    } finally {
      setChargement(false);
    }
  }

  async function importer() {
    if (!photoDataUrl || !fournisseurId) return;

    setChargement(true);
    setErreur("");
    try {
      const reponse = await creerListingPhoto({
        fournisseurId,
        societeId: 1,
        photoDataUrl,
        nomFichierOriginal: nomFichier || undefined,
        lignes: lignesExtraites,
      });
      setDocumentCree(reponse.document);
      setLignes(reponse.lignes);
      setChoix({});
      setRejets(new Set());
      setEtape(3);
    } catch (error) {
      setErreur(error instanceof Error ? error.message : "Impossible d'importer ce listing");
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
          if (!articleRetenuId) return null; // aucune décision prise : ligne laissée en attente
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
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "85vh",
        overflowY: "auto",
      }}
    >
      <h2>Importer un listing fournisseur par photo</h2>

      {etape === 1 && (
        <div>
          <label>Fournisseur</label>
          <select
            value={fournisseurId}
            onChange={(e) => setFournisseurId(Number(e.target.value))}
            style={{ width: "100%", padding: 10, marginBottom: 20 }}
          >
            {fournisseurs.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nom}
              </option>
            ))}
          </select>

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
            {photoDataUrl ? "Changer la photo" : "Prendre ou choisir une photo du listing"}
            {/* Pas d'attribut capture : laisse le choix entre appareil photo et photothèque. */}
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
            {lignesExtraites.length} ligne(s) reconnue(s). Vérifie-les avant de continuer — rien
            n'est encore enregistré.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
            {lignesExtraites.map((ligne, index) => (
              <div key={index} style={{ border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", fontSize: 13 }}>
                <strong>{ligne.designation}</strong> — {ligne.prix ?? "prix illisible"}
                {ligne.conditionnement ? ` — ${ligne.conditionnement}` : ""}
                {ligne.reference ? ` — réf. ${ligne.reference}` : ""}
              </div>
            ))}
          </div>
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
        {etape === 2 && (
          <button onClick={() => setEtape(1)} disabled={chargement}>
            Retour
          </button>
        )}
        {etape !== 4 && <button onClick={onClose}>Annuler</button>}
        {etape === 1 && (
          <button onClick={analyser} disabled={chargement || !photoDataUrl || !fournisseurId}>
            {chargement ? "Analyse en cours…" : "Analyser"}
          </button>
        )}
        {etape === 2 && (
          <button onClick={importer} disabled={chargement}>
            {chargement ? "Import en cours…" : "Continuer"}
          </button>
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

// Exporté pour être réutilisé tel quel par ImportFacturePhotoModal.tsx (Phase 6) : même logique de
// décision niveau A/B/C pour une ligne de facture que pour une ligne de listing, jamais dupliquée.
export function LigneListingPhoto({
  ligne,
  rejetee,
  choix,
  onChoisir,
  onRejeter,
}: {
  ligne: LigneDocumentFournisseur;
  rejetee: boolean;
  choix: number | null;
  onChoisir: (articleId: number) => void;
  onRejeter: (rejetee: boolean) => void;
}) {
  const styleLigne = { border: "1px solid #ddd", borderRadius: 6, padding: "8px 10px", fontSize: 13 };

  if (ligne.natureLigne !== "ARTICLE") {
    return (
      <div style={{ ...styleLigne, background: "#f4f4f4" }}>
        <strong>{ligne.designationLue}</strong>
        <div style={{ marginTop: 4, color: "#666" }}>{LIBELLE_NATURE[ligne.natureLigne]}</div>
      </div>
    );
  }

  const candidatsPossibles =
    ligne.articleProposeId !== null
      ? [{ articleId: ligne.articleProposeId, nom: "(article proposé)", score: ligne.confiance ?? 1 }]
      : (ligne.candidatsAlternatifs ?? []);

  return (
    <div style={{ ...styleLigne, background: rejetee ? "#fdeeee" : "#fff" }}>
      <strong>{ligne.designationLue}</strong> — {ligne.prixLu !== null ? `${ligne.prixLu} €` : "prix illisible"}

      {candidatsPossibles.length === 0 && (
        <div style={{ marginTop: 4, color: "#b00020" }}>
          Aucun article correspondant — cette ligne ne peut être validée que si un article est créé
          au préalable dans la base ingrédients, puis ré-importée.
        </div>
      )}

      {candidatsPossibles.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {ligne.motifCorrespondance && (
            <div style={{ marginBottom: 4, color: "#666" }}>{LIBELLE_MOTIF[ligne.motifCorrespondance]}</div>
          )}
          {candidatsPossibles.map((candidat) => (
            <label key={candidat.articleId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                name={`ligne-${ligne.id}`}
                checked={choix === candidat.articleId}
                disabled={rejetee}
                onChange={() => onChoisir(candidat.articleId)}
              />
              {ligne.articleProposeId !== null
                ? "Confirmer cette correspondance"
                : `${candidat.nom} (score ${(candidat.score * 100).toFixed(0)}%)`}
            </label>
          ))}
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, color: "#b00020" }}>
        <input type="checkbox" checked={rejetee} onChange={(e) => onRejeter(e.target.checked)} />
        Rejeter cette ligne (aucun tarif ne sera créé)
      </label>
    </div>
  );
}
