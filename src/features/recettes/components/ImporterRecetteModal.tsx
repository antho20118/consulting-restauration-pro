import { useState } from "react";
import { Camera } from "lucide-react";
import toast from "react-hot-toast";
import { redimensionnerImage } from "../../../common/redimensionnerImage";
import {
  ErreurImportIA,
  getAliasIngredients,
  getArticlesDisponibles,
  getCategoriesRecette,
  getSousCategoriesRecette,
  getUnitesDisponibles,
  importerRecetteIA,
} from "../services/recetteService";
import { analyseRecetteLocale } from "../utils/analyseRecetteLocale";
import { estFournisseurSuperU, filtrerSuperUActif } from "../utils/filtreFournisseur";
import { construireLigneImportee, construireMaterielImporte, materielVersLigne } from "../utils/ligneImportee";
import { extraireTexteDePhoto } from "../utils/ocrPhoto";
import PrevisualisationImportRecette from "./PrevisualisationImportRecette";
import type {
  AliasIngredient,
  ArticleRecette,
  BrouillonRecette,
  ExtractionRecette,
  LigneRecetteInput,
  PatchImportRecette,
  Recette,
  UniteRecette,
} from "../types/recette";

type CategorieOption = { id: number; nom: string };
type SousCategorieOption = { id: number; nom: string; parentId: number | null };

type Props = {
  onClose: () => void;
  // Le mode est déterminé par lequel des deux callbacks est fourni, jamais par la présence de
  // recetteActuelle : RecetteForm.tsx passe toujours onComplete, y compris quand il est ouvert pour
  // une nouvelle recette (recette=null) — c'est bien le formulaire déjà ouvert qui reçoit le
  // résultat dans ce cas, pas une nouvelle fiche séparée (voir la refonte de l'import photo/texte,
  // section 16 : "modification" = import dans une recette DÉJÀ OUVERTE, persistée ou non encore).
  // recetteActuelle sert uniquement à comparer "valeur actuelle" dans la prévisualisation — reste
  // null pour une recette pas encore enregistrée.
  recetteActuelle?: Recette | null;
  onCree?: (brouillon: BrouillonRecette) => void;
  onComplete?: (patch: PatchImportRecette) => void;
};

// Fonction à part (plutôt qu'inline dans le catch ci-dessous) : le rétrécissement de type de
// `source` par TypeScript ne survit pas à l'entrée d'un bloc catch, même via une simple relecture
// de la même constante.
async function obtenirTexteSource(source: { texte: string } | { photoDataUrl: string }): Promise<string> {
  return "texte" in source ? source.texte : await extraireTexteDePhoto(source.photoDataUrl);
}

// Moteur d'import unique (voir la refonte de l'import photo/texte) : que ce soit pour créer une
// recette complète ou pour compléter une recette déjà ouverte, la même analyse structurée
// (extraireRecette côté serveur, ou analyseRecetteLocale en repli sans IA) alimente la même
// prévisualisation globale — remplace les anciens ImporterRecetteModal (création uniquement) et
// ImporterTechniquesModal (étapes uniquement, dupliquant la même logique d'extraction).
export default function ImporterRecetteModal({ onClose, recetteActuelle, onCree, onComplete }: Props) {
  const [mode, setMode] = useState<"texte" | "photo">("texte");
  const [texte, setTexte] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const [extraction, setExtraction] = useState<ExtractionRecette | null>(null);
  const [lignesIngredients, setLignesIngredients] = useState<LigneRecetteInput[]>([]);
  const [lignesMateriel, setLignesMateriel] = useState<LigneRecetteInput[]>([]);
  const [articles, setArticles] = useState<ArticleRecette[]>([]);
  const [unites, setUnites] = useState<UniteRecette[]>([]);
  const [categories, setCategories] = useState<CategorieOption[]>([]);
  const [sousCategories, setSousCategories] = useState<SousCategorieOption[]>([]);

  const modeCompletion = onComplete != null;

  async function choisirPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    try {
      // Une photo de recette doit rester lisible (texte parfois petit) : une largeur plus
      // généreuse que celle utilisée pour une simple photo d'illustration du plat.
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
      let extractionRecue: ExtractionRecette;
      try {
        extractionRecue = await importerRecetteIA(source);
      } catch (error) {
        if (!(error instanceof ErreurImportIA) || error.status !== 503) throw error;

        // IA non configurée (pas de clé ANTHROPIC_API_KEY) : repli gratuit, mais nettement moins
        // fiable — texte lu par OCR (Tesseract) pour une photo, puis analyse par règles dans les
        // deux cas (voir analyseRecetteLocale.ts).
        toast(
          "IA non configurée : analyse locale utilisée (moins précise, à vérifier).",
          { icon: "ℹ️" }
        );
        extractionRecue = analyseRecetteLocale(await obtenirTexteSource(source));
      }

      if (
        extractionRecue.ingredients.length === 0 &&
        extractionRecue.etapes.length === 0 &&
        extractionRecue.materiel.length === 0
      ) {
        toast.error("Rien d'exploitable n'a été reconnu dans cette source.");
        return;
      }

      const [articlesTous, unitesData, alias, categoriesData, sousCategoriesData] = await Promise.all([
        getArticlesDisponibles(),
        getUnitesDisponibles(),
        getAliasIngredients(),
        getCategoriesRecette(),
        getSousCategoriesRecette(),
      ]);
      const aliasParTexte = new Map(alias.map((a: AliasIngredient) => [a.texteNormalise, a.articleId]));
      // Même préférence que dans le formulaire de recette (voir filtreFournisseur.ts) : ne
      // rapproche automatiquement un ingrédient qu'avec un article fourni par Super U si la
      // préférence est active, pour éviter un mauvais rapprochement silencieux avec un article
      // d'un autre fournisseur portant un nom proche.
      const articlesFiltres = filtrerSuperUActif()
        ? articlesTous.filter((a) => estFournisseurSuperU(a))
        : articlesTous;

      const lignesIngr = extractionRecue.ingredients.map((ingredient) =>
        construireLigneImportee(ingredient, articlesFiltres, unitesData, aliasParTexte)
      );
      const lignesMat = extractionRecue.materiel.map((materiel) =>
        materielVersLigne(construireMaterielImporte(materiel, articlesTous, aliasParTexte), unitesData)
      );

      setArticles(articlesTous);
      setUnites(unitesData);
      setCategories(categoriesData);
      setSousCategories(sousCategoriesData);
      setLignesIngredients(lignesIngr);
      setLignesMateriel(lignesMat);
      setExtraction(extractionRecue);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setEnCours(false);
    }
  }

  const peutAnalyser = mode === "texte" ? texte.trim().length > 0 : photoDataUrl != null;

  if (extraction) {
    return (
      <PrevisualisationImportRecette
        extraction={extraction}
        lignesIngredients={lignesIngredients}
        lignesMateriel={lignesMateriel}
        articles={articles}
        unites={unites}
        categories={categories}
        sousCategories={sousCategories}
        modeCompletion={modeCompletion}
        recetteActuelle={recetteActuelle ?? null}
        onAnnuler={onClose}
        onValiderCreation={(brouillon) => {
          onCree?.(brouillon);
          onClose();
        }}
        onValiderCompletion={(patch) => {
          onComplete?.(patch);
          onClose();
        }}
      />
    );
  }

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
      <h2 style={{ marginTop: 0 }}>
        {modeCompletion
          ? `Importer depuis une photo ou un texte${recetteActuelle ? ` — « ${recetteActuelle.nom} »` : ""}`
          : "Importer une recette"}
      </h2>
      <p style={{ color: "var(--couleur-texte-attenue)" }}>
        {modeCompletion
          ? "Colle le texte d'une recette ou photographie-la : les informations reconnues (ingrédients, techniques, matériel...) te seront proposées, à valider avant d'être ajoutées à cette recette — rien n'est écrasé automatiquement."
          : "Colle le texte d'une recette ou photographie-la (recette manuscrite, page de livre…) : l'IA en extrait automatiquement les informations, à vérifier dans une prévisualisation avant de créer la fiche."}
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
          placeholder={"Sauté de veau (4 personnes)\n500 g d'épaule de veau\n1 oignon\n...\n1. Faire revenir la viande..."}
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
          {photoDataUrl ? "Changer la photo" : "Prendre ou choisir une photo de la recette"}
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
