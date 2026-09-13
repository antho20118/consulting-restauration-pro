import { useState } from "react";
import toast from "react-hot-toast";
import {
  getArticlesDisponibles,
  getUnitesDisponibles,
  importerRecetteIA,
} from "../services/recetteService";
import type { ArticleRecette, LigneRecetteInput, UniteRecette } from "../types/recette";

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

function normaliser(texte: string): string {
  return texte.normalize("NFD").replace(DIACRITIQUES, "").toLowerCase().trim();
}

function trouverArticle(nomExtrait: string, articles: ArticleRecette[]): ArticleRecette | null {
  const cible = normaliser(nomExtrait);
  if (!cible) return null;

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

export default function ImporterRecetteTexteModal({ onClose, onExtrait }: Props) {
  const [texte, setTexte] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function analyser() {
    if (!texte.trim()) return;
    setEnCours(true);
    try {
      const [extraction, articles, unites] = await Promise.all([
        importerRecetteIA(texte),
        getArticlesDisponibles(),
        getUnitesDisponibles(),
      ]);

      const lignes: LigneRecetteInput[] = extraction.ingredients.map((ingredient) => {
        const article = trouverArticle(ingredient.nomExtrait, articles);
        const unite = trouverUnite(ingredient.unite, unites);
        return {
          // 0 : pas de présélection, cohérent avec une ligne ajoutée manuellement — l'utilisateur
          // choisit lui-même l'article dans le champ de recherche si l'IA n'a pas trouvé de
          // correspondance dans le catalogue.
          articleId: article?.id ?? 0,
          quantite: ingredient.quantite ?? 0,
          uniteId: unite?.id ?? unites[0]?.id ?? 0,
          gainCuissonPct: 0,
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
      <h2 style={{ marginTop: 0 }}>Importer une recette depuis un texte</h2>
      <p style={{ color: "var(--couleur-texte-attenue)" }}>
        Colle le texte d'une recette (ingrédients et étapes) : l'IA en extrait automatiquement les
        informations pour pré-remplir le formulaire de création.
      </p>

      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        placeholder={"Sauté de veau (4 personnes)\n500 g d'épaule de veau\n1 oignon\n...\n1. Faire revenir la viande..."}
        rows={12}
        style={{ width: "100%", padding: 10, resize: "vertical", fontFamily: "inherit" }}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
        <button onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={analyser} disabled={enCours || !texte.trim()}>
          {enCours ? "Analyse en cours…" : "Analyser"}
        </button>
      </div>
    </div>
  );
}
