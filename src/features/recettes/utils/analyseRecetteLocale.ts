import type { ExtractionRecette, SectionEtape } from "../types/recette";

// Analyse par règles (regex), sans IA : sert de repli gratuit quand ANTHROPIC_API_KEY n'est pas
// configurée. Nettement moins robuste qu'un modèle de langage — ne reconnaît que des formulations
// assez standards ("500 g de farine", "1. Faire revenir…") et échoue sur des tournures libres
// ("une pincée de sel au goût") ou une mise en page inhabituelle. Produit le même format
// ExtractionRecette enrichi que le moteur IA (voir server/utils/importRecetteIA.ts), mais avec une
// confiance "faible" partout : contrairement à l'IA, ce repli ne sait pas détecter de façon fiable
// la catégorie, le matériel ou les notes résiduelles — ces champs restent donc toujours vides/null
// plutôt que de risquer d'inventer un résultat qui aurait l'air fiable. À utiliser en connaissance
// de cause : les résultats sont à vérifier plus attentivement que ceux de l'import IA.
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

// Détection de la température : un seul nombre suivi de °C — jamais retenue si le texte porte une
// plage ("180-200°C", "de 180 à 200°C") pour ne pas inventer une valeur unique au milieu d'un
// intervalle réellement donné par le document (le texte complet reste de toute façon conservé
// intégralement dans description).
const RE_TEMPERATURE_UNIQUE = /(?<!\d[-\sàa]{0,4})(\d{2,3})\s*°\s*c\b(?!\s*[-àa]\s*\d)/i;

// Détection de durée : un seul nombre suivi de minute(s)/heure(s)/h, avec la même prudence que pour
// la température vis-à-vis d'une plage ("40 à 50 minutes").
const RE_DUREE_UNIQUE =
  /(?<!\d[-\sàa]{0,4})(\d{1,3})\s*(minutes?|min\b|heures?|\bh\b)(?!\s*[-àa]\s*\d)/i;

const MOTS_CLES_PREPARATION = [
  "éplucher",
  "eplucher",
  "tailler",
  "ciseler",
  "mélanger",
  "melanger",
  "assaisonner",
  "mariner",
  "couper",
  "hacher",
  "émincer",
  "eminer",
  "laver",
  "peler",
  "découper",
  "decouper",
  "préparer",
  "preparer",
  "réaliser une sauce",
  "realiser une sauce",
];

const MOTS_CLES_CUISSON = [
  "cuire",
  "cuisson",
  "four",
  "rissoler",
  "griller",
  "dorer",
  "mijoter",
  "bouillir",
  "frire",
  "rôtir",
  "rotir",
  "poêler",
  "poeler",
  "vapeur",
  "braiser",
  "gratiner",
  "préchauffer",
  "prechauffer",
  "saisir",
];

const MOTS_CLES_DRESSAGE = [
  "dresser",
  "dressage",
  "disposer",
  "présenter",
  "presenter",
  "présentation",
  "presentation",
  "nappage",
  "napper",
  "finition",
  "décorer",
  "decorer",
  "assembler",
  "assemblage",
];

// Classification volontairement prudente : une étape qui ne contient aucun mot-clé reconnu reste
// "autre" plutôt que d'être rattachée par défaut à une section qu'elle ne concerne peut-être pas
// (voir la règle de non-invention) — contrairement à l'IA, qui peut classer d'après le sens général
// de la phrase et pas seulement des mots-clés isolés.
function classifierSection(texte: string): SectionEtape {
  const n = texte.toLowerCase();
  if (MOTS_CLES_CUISSON.some((m) => n.includes(m))) return "cuisson";
  if (MOTS_CLES_DRESSAGE.some((m) => n.includes(m))) return "dressage";
  if (MOTS_CLES_PREPARATION.some((m) => n.includes(m))) return "preparation";
  return "autre";
}

function extraireTemperatureC(texte: string): number | null {
  const m = RE_TEMPERATURE_UNIQUE.exec(texte);
  return m ? Number(m[1]) : null;
}

function extraireDureeMinutes(texte: string): number | null {
  const m = RE_DUREE_UNIQUE.exec(texte);
  if (!m) return null;
  const valeur = Number(m[1]);
  const uniteHeure = /^h(eures?)?$/i.test(m[2]);
  return uniteHeure ? valeur * 60 : valeur;
}

function extraireEtape(ligne: string, ordre: number): ExtractionRecette["etapes"][number] {
  const correspondance = RE_MARQUEUR_HACCP.exec(ligne);
  const description = correspondance ? ligne.slice(0, correspondance.index).trim() : ligne;
  return {
    ordre,
    titre: null,
    description,
    section: classifierSection(description),
    dureeMinutes: extraireDureeMinutes(description),
    temperatureC: extraireTemperatureC(description),
    modeCuisson: null,
    pointCritiqueHACCP: correspondance != null,
    controleHACCP: correspondance ? correspondance[1].trim() : null,
    confiance: "faible",
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
    if (matchPortions) {
      if (portions == null) portions = Number(matchPortions[1]);
      // Une ligne qui ne contient QUE l'indication de portions (ex. "(4 personnes)" seule, plutôt
      // que dans "Sauté de veau (4 personnes)") ne doit pas en plus être traitée comme une étape
      // ou un nom de recette — corrigé ici plutôt que d'accepter cette fausse étape.
      if (!ligne.replace(RE_PORTIONS, "").trim()) continue;
    }

    const matchEtape = RE_ETAPE_NUMEROTEE.exec(ligne);
    if (matchEtape) {
      etapes.push(extraireEtape(matchEtape[2].trim(), etapes.length + 1));
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
        ingredients.push({
          texteOriginal: ligne,
          nomExtrait,
          quantite,
          unite,
          precision: null,
          confiance: "faible",
        });
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
      etapes.push(extraireEtape(ligne, etapes.length + 1));
    }
  }

  return {
    nom,
    // Ni catégorie, ni sous-catégorie, ni matériel, ni notes résiduelles : ce repli par règles ne
    // sait pas les distinguer de façon fiable (voir l'en-tête de ce fichier) — laisser null/vide
    // plutôt que de deviner reste la seule option cohérente avec la règle de non-invention.
    categorieDetectee: null,
    sousCategorieDetectee: null,
    portions,
    poidsPortionG: null,
    poidsAccompagnementG: null,
    ingredients,
    etapes,
    materiel: [],
    instructions: null,
    alertes: [
      "Analyse locale (sans IA) : catégorie, sous-catégorie, matériel et notes complémentaires " +
        "non détectés automatiquement — à compléter manuellement si nécessaire.",
    ],
  };
}
