import { useState } from "react";
import { Camera } from "lucide-react";
import toast from "react-hot-toast";
import { redimensionnerImage } from "../../../common/redimensionnerImage";
import { ErreurImportIA, importerRecetteIA } from "../services/recetteService";
import { analyseRecetteLocale } from "../utils/analyseRecetteLocale";
import { extraireTexteDePhoto } from "../utils/ocrPhoto";
import type { EtapeRecetteInput, ExtractionRecette } from "../types/recette";

type Props = {
  onClose: () => void;
  // Ajoute les étapes extraites à celles déjà présentes dans le formulaire (jamais de création de
  // recette ni de remplacement) : sert à compléter une recette déjà enregistrée (souvent importée
  // sans techniques de réalisation) avec son mode opératoire réel, sans repartir de zéro.
  onEtapesExtraites: (etapes: EtapeRecetteInput[]) => void;
};

async function obtenirTexteSource(source: { texte: string } | { photoDataUrl: string }): Promise<string> {
  return "texte" in source ? source.texte : await extraireTexteDePhoto(source.photoDataUrl);
}

// Variante de ImporterRecetteModal.tsx dédiée aux étapes de préparation seules : contrairement à
// l'import d'une recette complète, on ignore ici le nom, les portions et les ingrédients éventuels
// (voir la consigne "fais abstraction des tableaux de recettes" — cette modale ne sert qu'à
// compléter des techniques de réalisation sur une recette dont les ingrédients existent déjà).
export default function ImporterTechniquesModal({ onClose, onEtapesExtraites }: Props) {
  const [mode, setMode] = useState<"texte" | "photo">("texte");
  const [texte, setTexte] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function choisirPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    try {
      setPhotoDataUrl(await redimensionnerImage(fichier, 1600));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de traiter cette photo");
    }
  }

  async function analyser() {
    const source =
      mode === "texte"
        ? texte.trim()
          ? { texte: texte.trim() }
          : null
        : photoDataUrl
          ? { photoDataUrl }
          : null;
    if (!source) return;

    setEnCours(true);
    try {
      let extraction: ExtractionRecette;
      try {
        extraction = await importerRecetteIA(source);
      } catch (error) {
        if (!(error instanceof ErreurImportIA) || error.status !== 503) throw error;

        toast(
          "IA non configurée : analyse locale utilisée (moins précise, à vérifier).",
          { icon: "ℹ️" }
        );
        extraction = analyseRecetteLocale(await obtenirTexteSource(source));
      }

      if (extraction.etapes.length === 0) {
        toast.error("Aucune étape reconnue dans ce texte.");
        return;
      }

      const nbHACCP = extraction.etapes.filter((e) => e.pointCritiqueHACCP).length;
      toast.success(
        `${extraction.etapes.length} étape${extraction.etapes.length > 1 ? "s" : ""} ajoutée${extraction.etapes.length > 1 ? "s" : ""}` +
          (nbHACCP > 0
            ? `, dont ${nbHACCP} point${nbHACCP > 1 ? "s" : ""} critique${nbHACCP > 1 ? "s" : ""} HACCP repéré${nbHACCP > 1 ? "s" : ""}.`
            : ".")
      );
      onEtapesExtraites(extraction.etapes);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setEnCours(false);
    }
  }

  const peutAnalyser = mode === "texte" ? texte.trim().length > 0 : photoDataUrl != null;

  return (
    <div
      style={{
        background: "white",
        padding: 24,
        borderRadius: 10,
        width: 600,
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
      }}
    >
      <h2 style={{ marginTop: 0 }}>Importer des techniques de réalisation</h2>
      <p style={{ color: "var(--couleur-texte-attenue)" }}>
        Colle le mode opératoire d'une recette (ou photographie-le) : les étapes sont ajoutées à
        celles déjà présentes ci-dessous, avec reconnaissance automatique des points critiques
        HACCP.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className={mode === "texte" ? "btn-primary" : undefined}
          onClick={() => setMode("texte")}
        >
          Coller du texte
        </button>
        <button
          className={mode === "photo" ? "btn-primary" : undefined}
          onClick={() => setMode("photo")}
        >
          <Camera size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
          Photographier
        </button>
      </div>

      {mode === "texte" ? (
        <textarea
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder={
            "1. Marquer la viande en cuisson\nRissoler les morceaux dans l'huile.\nCuire à cœur jusqu'à 68°C. [HACCP: sonde de température, ≥68°C à cœur]\n..."
          }
          rows={12}
          style={{ width: "100%", padding: 10, resize: "vertical", fontFamily: "inherit" }}
        />
      ) : (
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            height: 220,
            borderRadius: 8,
            border: "1px dashed var(--couleur-bordure)",
            cursor: "pointer",
            backgroundSize: "cover",
            backgroundPosition: "center",
            color: photoDataUrl ? "white" : "var(--couleur-texte-attenue)",
            textShadow: photoDataUrl ? "0 1px 3px rgba(0,0,0,.6)" : undefined,
            backgroundImage: photoDataUrl ? `url(${photoDataUrl})` : undefined,
          }}
        >
          <Camera size={22} />
          {photoDataUrl ? "Changer la photo" : "Prendre ou choisir une photo du mode opératoire"}
          <input type="file" accept="image/*" capture="environment" hidden onChange={choisirPhoto} />
        </label>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
        <button onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={analyser} disabled={enCours || !peutAnalyser}>
          {enCours ? "Analyse en cours…" : "Analyser"}
        </button>
      </div>
    </div>
  );
}
