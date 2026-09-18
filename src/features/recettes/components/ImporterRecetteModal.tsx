import { useState } from "react";
import { Camera } from "lucide-react";
import toast from "react-hot-toast";
import { redimensionnerImage } from "../../../common/redimensionnerImage";
import {
  ErreurImportIA,
  getAliasIngredients,
  getArticlesDisponibles,
  getUnitesDisponibles,
  importerRecetteIA,
} from "../services/recetteService";
import { analyseRecetteLocale } from "../utils/analyseRecetteLocale";
import { estFournisseurSuperU, filtrerSuperUActif } from "../utils/filtreFournisseur";
import { extraireTexteDePhoto } from "../utils/ocrPhoto";
import type {
  AliasIngredient,
  ArticleRecette,
  ExtractionRecette,
  LigneRecetteInput,
  UniteRecette,
} from "../types/recette";

type Props = {
  onClose: () => void;
  onExtrait: (brouillon: {
    nom?: string;
    portions?: number;
    lignes: LigneRecetteInput[];
    etapes: { description: string; pointCritiqueHACCP: boolean; controleHACCP: string | null }[];
  }) => void;
};

// Ignore les accents et la casse pour rapprocher un nom d'ingrédient extrait du texte (ex. « Crème
// fraîche ») du nom exact d'un article du catalogue (ex. « creme fraiche 20cl »).
const DIACRITIQUES = /[\u0300-\u036f]/g;

// Doit rester identique à normaliserTexte() côté serveur (server/utils/normaliserTexte.ts) : la
// mémoire de correspondance (AliasIngredientImport) est indexée sur ce même calcul, un écart
// produirait des clés différentes et l'alias ne serait jamais retrouvé.
function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(DIACRITIQUES, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function trouverArticle(
  nomExtrait: string,
  articles: ArticleRecette[],
  aliasParTexte: Map<string, number>
): ArticleRecette | null {
  const cible = normaliser(nomExtrait);
  if (!cible) return null;

  // Une correspondance déjà validée par l'utilisateur lors d'un import précédent (voir
  // AliasIngredientImport côté serveur) prime sur la recherche approximative ci-dessous : c'est
  // justement pour corriger les cas où celle-ci se trompait ou ne trouvait rien.
  const articleIdMemorise = aliasParTexte.get(cible);
  if (articleIdMemorise) {
    const article = articles.find((a) => a.id === articleIdMemorise);
    if (article) return article;
  }

  const exact = articles.find((a) => normaliser(a.nom) === cible);
  if (exact) return exact;

  const correspondances = articles.filter(
    (a) => normaliser(a.nom).includes(cible) || cible.includes(normaliser(a.nom))
  );
  if (correspondances.length === 0) return null;

  // À correspondance approximative égale, le nom le plus proche en longueur de celui recherché
  // est le plus probable (évite de préférer un nom d'article très générique qui contiendrait le
  // terme cherché comme sous-chaîne, ex. « Farine » dans « Farine de sarrasin »).
  return correspondances.reduce((meilleur, actuel) =>
    Math.abs(normaliser(actuel.nom).length - cible.length) <
    Math.abs(normaliser(meilleur.nom).length - cible.length)
      ? actuel
      : meilleur
  );
}

function trouverUnite(symbole: string | null, unites: UniteRecette[]): UniteRecette | null {
  if (!symbole) return null;
  return unites.find((u) => normaliser(u.symbole) === normaliser(symbole)) ?? null;
}

// Fonction à part (plutôt qu'inline dans le catch ci-dessous) : le rétrécissement de type de
// `source` par TypeScript ne survit pas à l'entrée d'un bloc catch, même via une simple relecture
// de la même constante.
async function obtenirTexteSource(source: { texte: string } | { photoDataUrl: string }): Promise<string> {
  return "texte" in source ? source.texte : await extraireTexteDePhoto(source.photoDataUrl);
}

export default function ImporterRecetteModal({ onClose, onExtrait }: Props) {
  const [mode, setMode] = useState<"texte" | "photo">("texte");
  const [texte, setTexte] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

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
      let extraction: ExtractionRecette;
      try {
        extraction = await importerRecetteIA(source);
      } catch (error) {
        if (!(error instanceof ErreurImportIA) || error.status !== 503) throw error;

        // IA non configurée (pas de clé ANTHROPIC_API_KEY) : repli gratuit, mais nettement moins
        // fiable — texte lu par OCR (Tesseract) pour une photo, puis analyse par règles dans les
        // deux cas (voir analyseRecetteLocale.ts).
        toast(
          "IA non configurée : analyse locale utilisée (moins précise, à vérifier).",
          { icon: "ℹ️" }
        );
        extraction = analyseRecetteLocale(await obtenirTexteSource(source));
      }

      const [articlesTous, unites, alias] = await Promise.all([
        getArticlesDisponibles(),
        getUnitesDisponibles(),
        getAliasIngredients(),
      ]);
      const aliasParTexte = new Map(alias.map((a: AliasIngredient) => [a.texteNormalise, a.articleId]));
      // Même préférence que dans le formulaire de recette (voir filtreFournisseur.ts) : ne
      // rapproche automatiquement un ingrédient qu'avec un article fourni par Super U si la
      // préférence est active, pour éviter un mauvais rapprochement silencieux avec un article
      // d'un autre fournisseur portant un nom proche.
      const articles = filtrerSuperUActif()
        ? articlesTous.filter((a) => estFournisseurSuperU(a))
        : articlesTous;

      const lignes: LigneRecetteInput[] = extraction.ingredients.map((ingredient) => {
        const article = trouverArticle(ingredient.nomExtrait, articles, aliasParTexte);
        const unite = trouverUnite(ingredient.unite, unites);
        return {
          // 0 : pas de présélection, cohérent avec une ligne ajoutée manuellement — l'utilisateur
          // choisit lui-même l'article dans le champ de recherche si rien n'a été trouvé.
          articleId: article?.id ?? 0,
          quantite: ingredient.quantite ?? 0,
          uniteId: unite?.id ?? unites[0]?.id ?? 0,
          gainCuissonPct: 0,
          // Conservé jusqu'à l'enregistrement de la recette pour mémoriser le choix de
          // l'utilisateur s'il corrige ou complète l'article (voir RecetteForm.tsx).
          texteIngredientImporte: ingredient.nomExtrait,
        };
      });

      const nbReconnus = lignes.filter((l) => l.articleId !== 0).length;
      if (extraction.ingredients.length > 0) {
        toast.success(
          `${nbReconnus} ingrédient${nbReconnus > 1 ? "s" : ""} sur ${extraction.ingredients.length} reconnu${nbReconnus > 1 ? "s" : ""} automatiquement. Complète le reste dans le formulaire.`
        );
      }

      onExtrait({
        nom: extraction.nom ?? undefined,
        portions: extraction.portions ?? undefined,
        lignes,
        etapes: extraction.etapes.map((description) => ({
          description,
          pointCritiqueHACCP: false,
          controleHACCP: null,
        })),
      });
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
      <h2 style={{ marginTop: 0 }}>Importer une recette</h2>
      <p style={{ color: "var(--couleur-texte-attenue)" }}>
        Colle le texte d'une recette ou photographie-la (recette manuscrite, page de livre…) : l'IA
        en extrait automatiquement les informations pour pré-remplir le formulaire de création.
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
