import { normaliserTexte } from "../../recettes/utils/normaliserTexte";
import type { ExtractionNutrition } from "../services/nutritionImportService";

// Analyse par règles (regex + mots-clés), sans IA : sert de repli gratuit quand ANTHROPIC_API_KEY
// n'est pas configurée — même principe que analyseRecetteLocale.ts (src/features/recettes/utils),
// mêmes limites assumées : ne reconnaît que des formulations d'étiquette assez standards et une
// confiance "faible" partout, contrairement à l'IA qui sait aussi distinguer une mention de traces
// incertaine d'une présence confirmée. Les valeurs nutritionnelles ne sont jamais déduites d'une
// base autre que 100 g/100 mL ; si le document ne donne que des valeurs par portion, elles sont
// silencieusement ignorées plutôt que mal converties (même préférence que l'IA sur ce point, voir
// server/utils/importNutritionIA.ts).

// Un mot-clé par allergène réglementaire (voir prisma/seed.ts pour les 14 codes) — volontairement
// permissif (ex. "beurre"/"fromage" pour LAIT) puisque la confiance reste toujours "faible" et que
// l'utilisateur revoit chaque détection avant validation, jamais appliquée automatiquement.
const MOTS_CLES_ALLERGENES: Record<string, string[]> = {
  GLUTEN: ["gluten", "ble", "froment", "orge", "seigle", "avoine", "epeautre", "kamut"],
  CRUSTACES: ["crustace"],
  OEUFS: ["oeuf"],
  POISSON: ["poisson"],
  ARACHIDES: ["arachide", "cacahuete", "cacahouete"],
  SOJA: ["soja", "soya"],
  LAIT: ["lait", "lactose", "lactoserum", "beurre", "fromage", "creme fraiche"],
  FRUITS_A_COQUE: [
    "fruits a coque",
    "amande",
    "noisette",
    "noix",
    "pistache",
    "cajou",
    "macadamia",
    "noix de pecan",
  ],
  CELERI: ["celeri"],
  MOUTARDE: ["moutarde"],
  SESAME: ["sesame"],
  SULFITES: ["sulfite", "anhydride sulfureux", "metabisulfite"],
  LUPIN: ["lupin"],
  MOLLUSQUES: ["mollusque", "huitre", "moule", "calamar", "seiche", "poulpe", "escargot"],
};

function normaliserPourRecherche(texte: string): string {
  return normaliserTexte(texte).replace(/œ/g, "oe").replace(/æ/g, "ae");
}

// Cherche le nombre le plus proche suivi d'une des unités attendues, après le mot-clé — une
// fenêtre large (plutôt qu'un simple "aucun chiffre entre les deux") pour ne pas être bloqué par
// une valeur kJ intercalée avant la valeur kcal recherchée (ex. "Énergie 1046 kJ / 250 kcal").
function extraireNombreProche(texteNormalise: string, motCle: string, unites: string[]): number | null {
  const uniteAlt = unites.join("|");
  const regex = new RegExp(`${motCle}[\\s\\S]{0,40}?(\\d+(?:[.,]\\d+)?)\\s*(?:${uniteAlt})\\b`, "i");
  const match = regex.exec(texteNormalise);
  if (!match) return null;
  const nombre = parseFloat(match[1].replace(",", "."));
  return Number.isFinite(nombre) ? nombre : null;
}

export function analyseNutritionLocale(texte: string): ExtractionNutrition {
  const texteNormalise = normaliserPourRecherche(texte);

  const nutrition = {
    energie: extraireNombreProche(texteNormalise, "energie", ["kcal"]),
    proteines: extraireNombreProche(texteNormalise, "proteines", ["g"]),
    glucides: extraireNombreProche(texteNormalise, "glucides", ["g"]),
    sucres: extraireNombreProche(texteNormalise, "\\bsucres\\b", ["g"]),
    lipides: extraireNombreProche(texteNormalise, "lipides", ["g"]),
    acidesGrasSatures: extraireNombreProche(texteNormalise, "acides gras satures", ["g"]),
    fibres: extraireNombreProche(texteNormalise, "fibres", ["g"]),
    sel: extraireNombreProche(texteNormalise, "\\bsel\\b", ["g"]),
  };

  // Bordure de mot en DÉBUT de mot-clé seulement (jamais un simple .includes(), ni une bordure de
  // fin) : un mot-clé aussi court que "ble" (blé, voir GLUTEN) apparaîtrait sinon comme un faux
  // positif à l'intérieur de "possible", "disponible"... — mais une bordure de FIN empêcherait de
  // reconnaître un pluriel ("oeufs" ne se terminant pas par "oeuf\b").
  const allergenesDetectes = Object.entries(MOTS_CLES_ALLERGENES)
    .filter(([, motsCles]) => motsCles.some((motCle) => new RegExp(`\\b${motCle}`).test(texteNormalise)))
    .map(([code]) => ({ code, confiance: "faible" as const }));

  const alertes = ["Analyse locale sans IA (mots-clés) : à vérifier plus attentivement qu'un résultat par IA."];

  return { allergenesDetectes, nutrition, alertes };
}
