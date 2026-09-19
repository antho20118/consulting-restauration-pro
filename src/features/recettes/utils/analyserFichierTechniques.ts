import { normaliserTexte } from "./normaliserTexte";
import type { EtapeRecetteInput } from "../types/recette";

export type LigneTechniqueExtraite = {
  code: string;
  nomFichier: string;
  prixFichier: number;
  quantite: number;
};

export type RecetteTechniqueExtraite = {
  titre: string;
  feuille: string;
  lignes: LigneTechniqueExtraite[];
  etapes: EtapeRecetteInput[];
  allergenesTexte: string | null;
};

const ETIQUETTES_COLONNES = new Set([
  "code prod",
  "produits",
  "tarifs",
  "quantites",
  "total",
  "prix de revient au kg",
  "ingredients",
  "quantite",
]);

function estAllergenes(valeur: unknown): boolean {
  return normaliserTexte(String(valeur ?? "")).replace(/:$/, "") === "allergenes";
}

function trouverPremierNonVide(valeurs: unknown[] | undefined): string | null {
  for (const v of valeurs ?? []) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return null;
}

// Une ligne de titre porte un seul texte isolé (ex. ["", "hachis parmentier", "", ...]) ; une
// ligne d'ingrédient porte en plus un prix en 3e colonne. Certaines feuilles n'ont pas de ligne de
// titre du tout (les ingrédients commencent dès la ligne 0) : dans ce cas on retombe sur le nom de
// la feuille, déjà le nom de la recette dans ce type de fichier.
function estLigneTitre(ligne: unknown[] | undefined): boolean {
  const nonVides = (ligne ?? []).filter((v) => String(v ?? "").trim() !== "");
  if (nonVides.length === 0) return false;
  if (nonVides.length === 1) return true;
  const prix = Number(ligne?.[2]);
  return !(prix && !Number.isNaN(prix) && prix > 0);
}

// Détection volontairement conservatrice des points critiques HACCP dans le texte libre d'une
// étape (pas de marqueur explicite dans ce type de fichier, contrairement à analyseRecetteLocale.ts) :
// mieux vaut rater un point que d'en signaler un partout où le mot "cuisson" apparaît.
const REGLES_HACCP: { regex: RegExp; controle: string }[] = [
  {
    regex: /\d{2,3}\s*°c.{0,30}(cuiss|cuire|cuit|four|rissol|griller|dorer)|( cuiss|cuire|cuit|four|rissol|griller|dorer).{0,30}\d{2,3}\s*°c/,
    controle: "Contrôler la température de cuisson atteinte.",
  },
  { regex: /(s'assurer|verifier).{0,25}cuisson/, controle: "Vérifier la cuisson à cœur." },
  {
    regex: /cellule de refroidissement|glacante|refroidir/,
    controle: "Refroidissement à contrôler (<10°C en moins de 2h).",
  },
  {
    regex: /remise en temp|rechauff/,
    controle: "Remise en température : +3°C à +63°C en moins d'1h.",
  },
  { regex: /\bmariner\b/, controle: "Contrôler le temps et la température de marinade (chambre froide)." },
];

function construireEtape(texte: string): EtapeRecetteInput {
  const n = normaliserTexte(texte);
  const controles = REGLES_HACCP.filter((r) => r.regex.test(n)).map((r) => r.controle);
  return {
    description: texte,
    pointCritiqueHACCP: controles.length > 0,
    controleHACCP: controles.length > 0 ? controles.join(" ") : null,
  };
}

function extraireRecetteFeuille(rows: unknown[][], nomFeuille: string): RecetteTechniqueExtraite | null {
  const ligneEstTitre = estLigneTitre(rows[0]);
  const titre = (ligneEstTitre ? trouverPremierNonVide(rows[0]) : nomFeuille) ?? nomFeuille;
  const debut = ligneEstTitre ? 1 : 0;

  let allergenesTexte: string | null = null;
  for (const row of rows) {
    if (estAllergenes(row[0])) {
      allergenesTexte = trouverPremierNonVide(row.slice(1));
      break;
    }
  }

  const lignes: LigneTechniqueExtraite[] = [];
  for (let i = debut; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[0] ?? "").trim();
    const nom = String(row[1] ?? "").trim();
    if (ETIQUETTES_COLONNES.has(normaliserTexte(code)) || ETIQUETTES_COLONNES.has(normaliserTexte(nom))) continue;
    if (/^\d+\s*[.)]/.test(code) || /^\d+\s*[.)]/.test(nom)) break; // début des étapes
    if (estAllergenes(code)) break;
    if (!nom) continue;
    lignes.push({ code, nomFichier: nom, prixFichier: Number(row[2]) || 0, quantite: Number(row[3]) || 0 });
  }

  const etapes: EtapeRecetteInput[] = [];
  let texteCourant: string | null = null;
  let dansEtapes = false;
  for (const row of rows) {
    const texte = String(row[0] ?? "").trim();
    if (estAllergenes(row[0])) {
      if (dansEtapes) break;
      continue;
    }
    const correspondance = texte.match(/^(\d+)\s*[.)]\s*(.+)/);
    if (correspondance) {
      dansEtapes = true;
      if (texteCourant) etapes.push(construireEtape(texteCourant));
      texteCourant = correspondance[2].trim();
      continue;
    }
    if (dansEtapes && texte) texteCourant += "\n" + texte;
  }
  if (texteCourant) etapes.push(construireEtape(texteCourant));

  if (lignes.length === 0 && etapes.length === 0) return null;

  return { titre, feuille: nomFeuille, lignes, etapes, allergenesTexte };
}

export async function analyserFichierTechniques(fichier: File): Promise<RecetteTechniqueExtraite[]> {
  const XLSX = await import("xlsx");

  const classeur = XLSX.read(await fichier.arrayBuffer(), { type: "array" });

  const recettes: RecetteTechniqueExtraite[] = [];
  for (const nomFeuille of classeur.SheetNames) {
    const feuille = classeur.Sheets[nomFeuille];
    const lignesBrutes: unknown[][] = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: "" });
    const recette = extraireRecetteFeuille(lignesBrutes, nomFeuille.trim());
    if (recette) recettes.push(recette);
  }

  return recettes;
}

// Retire les précisions de poids/portion très variables d'une source à l'autre (ex. "(2900gr)",
// "environ 1200gr", "1,150kg") pour comparer les titres par leur seul nom de plat.
function nettoyerTitre(titre: string): string {
  return normaliserTexte(titre)
    .replace(/\(.*?\)/g, " ")
    .replace(/environ\s*\d+\s*(g|gr|kg)?/g, " ")
    .replace(/\d+[.,]?\d*\s*(g|gr|kg)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type RecetteExistante = { id: number; nom: string };

// Rapproche le titre d'une fiche technique d'une recette déjà existante, par égalité puis par
// inclusion du titre nettoyé le plus court dans le plus long (ex. "hachis parmentier" doit
// retrouver "HACHIS PARMENTIER (2300gr)") — jamais par simple similarité de mots isolés, qui
// confondrait trop facilement deux plats différents partageant un mot (ex. "sauce" ou "riz").
export function trouverRecetteCorrespondante(
  titreTechnique: string,
  recettes: RecetteExistante[]
): RecetteExistante | null {
  const cible = nettoyerTitre(titreTechnique);
  if (!cible) return null;

  const exact = recettes.find((r) => nettoyerTitre(r.nom) === cible);
  if (exact) return exact;

  const correspondances = recettes.filter((r) => {
    const nom = nettoyerTitre(r.nom);
    // Un nom vide (recette mal nommée) "inclut" et est "inclus dans" n'importe quelle chaîne :
    // sans cette garde, il correspondrait à tort à toutes les fiches techniques.
    if (!nom) return false;
    return nom.includes(cible) || cible.includes(nom);
  });
  if (correspondances.length === 0) return null;

  return correspondances.reduce((meilleure, actuelle) =>
    Math.abs(nettoyerTitre(actuelle.nom).length - cible.length) <
    Math.abs(nettoyerTitre(meilleure.nom).length - cible.length)
      ? actuelle
      : meilleure
  );
}
