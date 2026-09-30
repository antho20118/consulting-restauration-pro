import { useState } from "react";
import { Camera } from "lucide-react";
import toast from "react-hot-toast";
import { redimensionnerImage } from "../../../common/redimensionnerImage";
import { extraireTexteDePhoto } from "../../recettes/utils/ocrPhoto";
import { analyseNutritionLocale } from "../utils/analyseNutritionLocale";
import {
  ErreurImportNutritionIA,
  importerAllergenesNutritionIA,
  type ExtractionNutrition,
} from "../services/nutritionImportService";
import { CHAMPS_NUTRITION, type ChampNutritionCle } from "../utils/champsNutrition";
import type { Allergene } from "../types/ingredient";

type Props = {
  allergenes: Allergene[];
  // État actuel du formulaire ingrédient (jamais vide même à la création, voir IngredientForm.tsx) :
  // sert de base pour ne jamais effacer silencieusement une saisie manuelle déjà présente — une
  // détection ajoute aux allergènes déjà cochés (union, jamais un remplacement), et une valeur
  // nutritionnelle non détectée (null) laisse la valeur actuelle intacte plutôt que de la vider.
  allergeneIdsActuels: number[];
  nutritionActuelle: Record<ChampNutritionCle, string>;
  onClose: () => void;
  onValider: (resultat: { allergeneIds: number[]; nutrition: Record<ChampNutritionCle, string> }) => void;
};

// Fonction à part (même raison que ImporterRecetteModal.tsx : le rétrécissement de type de
// `source` ne survit pas à l'entrée d'un bloc catch).
async function obtenirTexteSource(source: { texte: string } | { photoDataUrl: string }): Promise<string> {
  return "texte" in source ? source.texte : await extraireTexteDePhoto(source.photoDataUrl);
}

// Même moteur d'import que ImporterRecetteModal.tsx (IA en premier, repli gratuit OCR + analyse
// par règles sur le même 503 « IA non configurée ») appliqué aux allergènes et valeurs
// nutritionnelles d'une étiquette plutôt qu'à une recette complète. Aperçu éditable avant
// application (step 2) : rien n'est jamais appliqué au formulaire ingrédient sans validation
// explicite, même principe que PrevisualisationImportRecette.tsx.
export default function ImporterNutritionModal({
  allergenes,
  allergeneIdsActuels,
  nutritionActuelle,
  onClose,
  onValider,
}: Props) {
  const [mode, setMode] = useState<"texte" | "photo">("texte");
  const [texte, setTexte] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const [extraction, setExtraction] = useState<ExtractionNutrition | null>(null);
  const [allergeneIdsChoisis, setAllergeneIdsChoisis] = useState<number[]>([]);
  const [nutritionEditable, setNutritionEditable] = useState<Record<ChampNutritionCle, string>>(
    {} as Record<ChampNutritionCle, string>
  );

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
      let extractionRecue: ExtractionNutrition;
      try {
        extractionRecue = await importerAllergenesNutritionIA(source);
      } catch (error) {
        if (!(error instanceof ErreurImportNutritionIA) || error.status !== 503) throw error;

        toast("IA non configurée : analyse locale utilisée (moins précise, à vérifier).", { icon: "ℹ️" });
        extractionRecue = analyseNutritionLocale(await obtenirTexteSource(source));
      }

      const codesDetectes = new Set(extractionRecue.allergenesDetectes.map((a) => a.code));
      const idsDetectes = allergenes.filter((a) => codesDetectes.has(a.code)).map((a) => a.id);
      setAllergeneIdsChoisis(Array.from(new Set([...allergeneIdsActuels, ...idsDetectes])));
      setNutritionEditable(
        Object.fromEntries(
          CHAMPS_NUTRITION.map(({ cle }) => {
            const valeurDetectee = extractionRecue.nutrition[cle];
            return [cle, valeurDetectee != null ? String(valeurDetectee) : nutritionActuelle[cle]];
          })
        ) as Record<ChampNutritionCle, string>
      );
      setExtraction(extractionRecue);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setEnCours(false);
    }
  }

  function basculerAllergene(id: number) {
    setAllergeneIdsChoisis((precedent) =>
      precedent.includes(id) ? precedent.filter((a) => a !== id) : [...precedent, id]
    );
  }

  const peutAnalyser = mode === "texte" ? texte.trim().length > 0 : photoDataUrl != null;

  if (extraction) {
    return (
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 10,
          width: 600,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 64px)",
          overflowY: "auto",
          boxSizing: "border-box",
          boxShadow: "0 0 20px rgba(0,0,0,.2)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Vérifier avant d'appliquer</h2>
        <p style={{ color: "var(--couleur-texte-attenue)" }}>
          Coche ou décoche les allergènes et corrige les valeurs si besoin : rien n'est appliqué à la
          fiche tant que tu n'as pas cliqué sur « Appliquer ».
        </p>

        {extraction.alertes.length > 0 && (
          <ul style={{ color: "#946200", fontSize: 13, paddingLeft: 18, marginBottom: 16 }}>
            {extraction.alertes.map((alerte, index) => (
              <li key={index}>{alerte}</li>
            ))}
          </ul>
        )}

        <label>Allergènes détectés</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginBottom: 20 }}>
          {allergenes.map((allergene) => (
            <label key={allergene.id} style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: "normal" }}>
              <input
                type="checkbox"
                checked={allergeneIdsChoisis.includes(allergene.id)}
                onChange={() => basculerAllergene(allergene.id)}
              />
              {allergene.nom}
            </label>
          ))}
        </div>

        <label>Valeurs nutritionnelles détectées (pour 100 g)</label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "10px 16px",
            marginBottom: 20,
          }}
        >
          {CHAMPS_NUTRITION.map(({ cle, label }) => (
            <div key={cle}>
              <label htmlFor={`import-nutrition-${cle}`} style={{ fontWeight: "normal", fontSize: 13 }}>
                {label}
              </label>
              <input
                id={`import-nutrition-${cle}`}
                type="number"
                step="0.01"
                min={0}
                value={nutritionEditable[cle] ?? ""}
                onChange={(e) => setNutritionEditable((precedent) => ({ ...precedent, [cle]: e.target.value }))}
                style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
              />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose}>Annuler</button>
          <button
            className="btn-primary"
            onClick={() => onValider({ allergeneIds: allergeneIdsChoisis, nutrition: nutritionEditable })}
          >
            Appliquer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "white",
        padding: 24,
        borderRadius: 10,
        width: 600,
        maxWidth: "calc(100vw - 32px)",
        boxSizing: "border-box",
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
      }}
    >
      <h2 style={{ marginTop: 0 }}>Importer depuis une étiquette</h2>
      <p style={{ color: "var(--couleur-texte-attenue)" }}>
        Colle le texte d'une étiquette (liste d'ingrédients et/ou valeurs nutritionnelles) ou
        photographie-la : les allergènes et valeurs reconnus te seront proposés, à vérifier avant
        d'être appliqués à la fiche — rien n'est écrasé automatiquement.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={mode === "texte" ? "btn-primary" : undefined} onClick={() => setMode("texte")}>
          Coller du texte
        </button>
        <button className={mode === "photo" ? "btn-primary" : undefined} onClick={() => setMode("photo")}>
          <Camera size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
          Photographier
        </button>
      </div>

      {mode === "texte" ? (
        <textarea
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder={"Ingrédients : farine de blé, lait, oeufs...\nValeurs nutritionnelles pour 100 g : Énergie 250 kcal, Protéines 5 g..."}
          rows={10}
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
          {photoDataUrl ? "Changer la photo" : "Prendre ou choisir une photo de l'étiquette"}
          <input type="file" accept="image/*" hidden onChange={choisirPhoto} />
        </label>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
        <button onClick={onClose}>Annuler</button>
        <button className="btn-primary" disabled={!peutAnalyser || enCours} onClick={analyser}>
          {enCours ? "Analyse en cours…" : "Analyser"}
        </button>
      </div>
    </div>
  );
}
