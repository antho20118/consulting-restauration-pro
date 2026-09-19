import type { ExtractionRecette } from "../types/recette";

// Analyse par règles (regex), sans IA : sert de repli gratuit quand ANTHROPIC_API_KEY n'est pas
// configurée. Nettement moins robuste qu'un modèle de langage — ne reconnaît que des formulations
// assez standards ("500 g de farine", "1. Faire revenir…") et échoue sur des tournures libres
// ("une pincée de sel au goût") ou une mise en page inhabituelle. À utiliser en connaissance de
// cause : les résultats sont à vérifier plus attentivement que ceux de l'import IA.
const UNITES_CONNUES = [
  "kg",
  "g",
  "mg",
  "l",
  "cl",
  "ml",
  "pièce",
  "pièces",
  "piece",
  "pieces",
  "cuillère à soupe",
  "cuillères à soupe",
  "cuillère à café",
  "cuillères à café",
  "pincée",
  "pincées",
  "botte",
  "bottes",
  "gousse",
  "gousses",
  "tranche",
  "tranches",
  "sachet",
  "sachets",
  "boîte",
  "boîtes",
  "boite",
  "boites",
];

const MOTS_ENTETE = [
  "ingrédients",
  "ingredients",
  "préparation",
  "preparation",
  "étapes",
  "etapes",
  "instructions",
  "recette",
  "procédé",
  "procede",
];

// Ligne d'ingrédient : quantité (entière, décimale ou fraction) optionnelle, suivie d'un mot
// (potentiellement une unité connue) puis du reste de la ligne, avec un connecteur "de"/"d'"
// optionnel entre l'unité et le nom (ex. "500 g de farine", "1 pincée de sel", "2 oeufs").
const RE_INGREDIENT =
  /^[-•*]?\s*(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*([a-zàâäéèêëïîôöùûüç.]+)?\s*(?:de\s+|d')?(.*)$/i;

// Certaines mises en page (magazines de cuisine notamment) numérotent les étapes avec un chevron
// (»/›) plutôt qu'un point ou une parenthèse.
const RE_ETAPE_NUMEROTEE = /^(\d+)[.)»›]\s*(.+)$/;

const RE_PORTIONS = /\(?\s*(\d+)\s*(?:personnes?|portions?|parts?|couverts?)\s*\)?/i;

// Une étape peut porter un point de contrôle HACCP explicite en fin de ligne, ex. :
// "Cuire à cœur jusqu'à 68°C. [HACCP: sonde de température, ≥68°C à cœur]" — convention utilisée
// pour les fiches préparées à l'avance (voir la génération des textes à importer), reconnue ici
// pour remplir automatiquement les champs dédiés plutôt que de laisser l'utilisateur les recopier
// à la main après l'import.
const RE_MARQUEUR_HACCP = /\s*\[\s*HACCP\s*:\s*(.+?)\s*\]\s*$/i;

function extraireEtape(ligne: string): ExtractionRecette["etapes"][number] {
  const correspondance = RE_MARQUEUR_HACCP.exec(ligne);
  if (!correspondance) {
    return { description: ligne, pointCritiqueHACCP: false, controleHACCP: null };
  }
  return {
    description: ligne.slice(0, correspondance.index).trim(),
    pointCritiqueHACCP: true,
    controleHACCP: correspondance[1].trim(),
  };
}

function normaliserLigne(ligne: string): string {
  return ligne.toLowerCase().replace(/[:：]\s*$/, "").trim();
}

function normaliserNombre(brut: string): number | null {
  if (!brut) return null;
  if (brut.includes("/")) {
    const [a, b] = brut.split("/").map((n) => Number(n.trim().replace(",", ".")));
    return b ? a / b : null;
  }
  const n = Number(brut.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function analyseRecetteLocale(texteBrut: string): ExtractionRecette {
  const lignes = texteBrut
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let nom: string | null = null;
  let portions: number | null = null;
  const ingredients: ExtractionRecette["ingredients"] = [];
  const etapes: ExtractionRecette["etapes"] = [];

  for (const ligne of lignes) {
    if (MOTS_ENTETE.includes(normaliserLigne(ligne))) continue;

    const matchPortions = RE_PORTIONS.exec(ligne);
    if (matchPortions && portions == null) {
      portions = Number(matchPortions[1]);
    }

    const matchEtape = RE_ETAPE_NUMEROTEE.exec(ligne);
    if (matchEtape) {
      etapes.push(extraireEtape(matchEtape[2].trim()));
      continue;
    }

    const matchIngredient = RE_INGREDIENT.exec(ligne);
    if (matchIngredient) {
      const quantite = normaliserNombre(matchIngredient[1]);
      const uniteBrute = matchIngredient[2]?.toLowerCase().trim() ?? "";
      const unite = UNITES_CONNUES.find((u) => uniteBrute === u) ?? null;
      const nomExtrait = (
        unite ? matchIngredient[3] : `${matchIngredient[2] ?? ""} ${matchIngredient[3]}`
      ).trim();
      if (nomExtrait) {
        ingredients.push({ texteOriginal: ligne, nomExtrait, quantite, unite });
        continue;
      }
    }

    if (nom == null && ingredients.length === 0 && etapes.length === 0) {
      const sansPortions = ligne.replace(RE_PORTIONS, "").trim();
      nom = sansPortions || null;
    } else {
      // Toute ligne libre non numérotée après la première ligne (le nom) est traitée comme une
      // étape de préparation — y compris quand aucun ingrédient n'a été reconnu (ex. un texte qui
      // ne colle que des techniques de réalisation) : exiger `ingredients.length > 0` faisait
      // disparaître silencieusement ces étapes.
      etapes.push(extraireEtape(ligne));
    }
  }

  return { nom, portions, ingredients, etapes };
}
