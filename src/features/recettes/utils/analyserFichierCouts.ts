import { normaliserTexte } from "./normaliserTexte";

export type LigneCoutsExtraite = {
  code: string;
  nomFichier: string;
  prixFichier: number;
  quantite: number;
};

export type RecetteCoutsExtraite = {
  titre: string;
  feuille: string;
  categorieParDefaut: string;
  sousCategorieParDefaut: string | null;
  lignes: LigneCoutsExtraite[];
  allergenesTexte: string | null;
};

// Catégorie/sous-catégorie proposées par défaut selon la feuille d'origine (éditables ensuite
// dans l'aperçu avant import) : sert juste à ne pas repartir de zéro pour chaque recette.
const CATEGORIE_PAR_FEUILLE: Record<string, string> = {
  "PLATS COMPLETS": "Plat",
  SAUCES_: "Plat",
  PATES: "Plat",
  _ACCOMPAGNEMENTS: "Accompagnement",
  VIANDES: "Plat",
  POISSONS: "Plat",
  ENTREES_FROIDES: "Entrée",
  ENTREES_CHAUDES: "Entrée",
  VEGETARIEN: "Plat",
};

const SOUS_CATEGORIE_PAR_FEUILLE: Record<string, string> = {
  VIANDES: "Viande",
  POISSONS: "Poisson",
  PATES: "Pâtes",
};

// Nom des colonnes d'un bloc-recette dans ce type de fichier de coûts (répété plusieurs fois par
// ligne d'en-tête, une fois par recette affichée côte à côte). Détecté par ses deux premières
// colonnes, insensible à la casse/aux accents.
function estColonneEntete(valeurCode: unknown, valeurProduit: unknown): boolean {
  return normaliserTexte(String(valeurCode ?? "")) === "code prod" &&
    normaliserTexte(String(valeurProduit ?? "")) === "produits";
}

function extraireRecettesFeuille(lignes: unknown[][], nomFeuille: string): RecetteCoutsExtraite[] {
  const recettes: RecetteCoutsExtraite[] = [];
  const categorieParDefaut = CATEGORIE_PAR_FEUILLE[nomFeuille] ?? "Plat";
  const sousCategorieParDefaut = SOUS_CATEGORIE_PAR_FEUILLE[nomFeuille] ?? null;

  for (let r = 0; r < lignes.length; r++) {
    const ligne = lignes[r];

    // Un même row peut porter l'en-tête de plusieurs blocs-recettes affichés côte à côte.
    const colonnesEntete: number[] = [];
    for (let c = 0; c < ligne.length; c++) {
      if (estColonneEntete(ligne[c], ligne[c + 1])) colonnesEntete.push(c);
    }
    if (colonnesEntete.length === 0) continue;

    // Titres trouvés sur la ligne au-dessus, appariés par ordre d'apparition aux en-têtes de
    // blocs : dans ce fichier, les cellules de titre fusionnées ne s'alignent pas toujours
    // exactement avec le début de leur bloc, l'ordre est plus fiable que la position.
    const ligneTitres = lignes[r - 1] ?? [];
    const titres = ligneTitres
      .map((v) => String(v ?? "").trim())
      .filter((v) => v !== "");

    colonnesEntete.forEach((c, index) => {
      const titre = titres[index] ?? "";
      if (!titre) return;

      const lignesExtraites: LigneCoutsExtraite[] = [];
      let allergenesTexte: string | null = null;

      for (let i = r + 1; i < Math.min(lignes.length, r + 60); i++) {
        const ligneProduit = lignes[i];
        const code = ligneProduit[c];
        const nomFichier = String(ligneProduit[c + 1] ?? "").trim();

        if (estColonneEntete(code, ligneProduit[c + 1])) break; // bloc-recette suivant
        if (normaliserTexte(String(code ?? "")) === "allergenes") {
          allergenesTexte = String(ligneProduit[c + 1] ?? "").trim() || null;
          break;
        }
        if (!nomFichier) continue; // ligne vide du gabarit, on continue de chercher plus bas

        lignesExtraites.push({
          code: String(code ?? "").trim(),
          nomFichier,
          prixFichier: Number(ligneProduit[c + 2]) || 0,
          quantite: Number(ligneProduit[c + 3]) || 0,
        });
      }

      if (lignesExtraites.length > 0) {
        recettes.push({
          titre,
          feuille: nomFeuille,
          categorieParDefaut,
          sousCategorieParDefaut,
          lignes: lignesExtraites,
          allergenesTexte,
        });
      }
    });
  }

  return recettes;
}

export async function analyserFichierCouts(fichier: File): Promise<RecetteCoutsExtraite[]> {
  const XLSX = await import("xlsx");

  const classeur = XLSX.read(await fichier.arrayBuffer(), { type: "array" });

  const recettes: RecetteCoutsExtraite[] = [];
  for (const nomFeuille of classeur.SheetNames) {
    // La feuille catalogue (codes -> désignation/prix Super U) n'est pas une feuille de
    // recettes : elle sert uniquement à afficher le nom d'un code sans correspondance (voir
    // ImporterFichierCoutsModal.tsx), lue séparément par analyserCatalogueFichierCouts.
    if (normaliserTexte(nomFeuille).includes("liste_produit")) continue;

    const feuille = classeur.Sheets[nomFeuille];
    const lignesBrutes: unknown[][] = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: "" });
    recettes.push(...extraireRecettesFeuille(lignesBrutes, nomFeuille.trim()));
  }

  return recettes;
}

export type ArticleCatalogue = {
  code: string;
  denomination: string;
};

// Lit la feuille catalogue (nom, prix Super U) uniquement pour donner un nom lisible aux codes
// sans correspondance dans l'aperçu — jamais utilisée pour créer des articles automatiquement.
export async function analyserCatalogueFichierCouts(
  fichier: File
): Promise<Map<string, ArticleCatalogue>> {
  const XLSX = await import("xlsx");

  const classeur = XLSX.read(await fichier.arrayBuffer(), { type: "array" });
  const nomFeuille = classeur.SheetNames.find((n) => normaliserTexte(n).includes("liste_produit"));

  const catalogue = new Map<string, ArticleCatalogue>();
  if (!nomFeuille) return catalogue;

  const lignes: unknown[][] = XLSX.utils.sheet_to_json(classeur.Sheets[nomFeuille], {
    header: 1,
    defval: "",
  });

  for (const ligne of lignes) {
    const code = String(ligne[0] ?? "").trim();
    const denomination = String(ligne[2] ?? "").trim();
    if (!code || !denomination) continue;
    catalogue.set(code, { code, denomination });
  }

  return catalogue;
}
