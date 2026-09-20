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
  // Assaisonnements de base (sel, poivre...) détectés comme quasi systématiques dans les autres
  // recettes du même fichier, mais absents de celle-ci : proposés à l'import (voir
  // ImporterFichierCoutsModal.tsx), jamais ajoutés automatiquement sans confirmation.
  suggestionsBase: LigneCoutsExtraite[];
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

type Fusion = { s: { r: number; c: number }; e: { r: number; c: number } };

// Résout le titre d'un bloc-recette en cherchant, sur la ligne au-dessus de son en-tête, la
// cellule dont la portée (fusionnée ou non) recouvre au moins une des colonnes du bloc : plus
// fiable que d'apparier les titres à l'en-tête par simple ordre d'apparition sur la ligne, qui se
// dérègle dès qu'un titre est vide ou qu'une fusion déborde sur le bloc voisin (une seule cellule
// de titre mal alignée décale alors tous les titres suivants de la ligne).
function trouverTitreBloc(
  lignes: unknown[][],
  fusions: Fusion[],
  ligneTitre: number,
  colDebut: number,
  colFin: number
): string {
  if (ligneTitre < 0) return "";

  for (const fusion of fusions) {
    if (
      fusion.s.r <= ligneTitre &&
      ligneTitre <= fusion.e.r &&
      fusion.s.c <= colFin &&
      fusion.e.c >= colDebut
    ) {
      const valeur = String(lignes[fusion.s.r]?.[fusion.s.c] ?? "").trim();
      if (valeur) return valeur;
    }
  }

  const ligne = lignes[ligneTitre] ?? [];
  for (let c = colDebut; c <= colFin; c++) {
    const valeur = String(ligne[c] ?? "").trim();
    if (valeur) return valeur;
  }

  return "";
}

function extraireRecettesFeuille(
  lignes: unknown[][],
  fusions: Fusion[],
  nomFeuille: string
): RecetteCoutsExtraite[] {
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

    colonnesEntete.forEach((c, index) => {
      const colFin = index + 1 < colonnesEntete.length ? colonnesEntete[index + 1] - 1 : ligne.length - 1;
      const titre = trouverTitreBloc(lignes, fusions, r - 1, c, colFin);
      if (!titre) return;

      const lignesExtraites: LigneCoutsExtraite[] = [];
      let allergenesTexte: string | null = null;

      for (let i = r + 1; i < Math.min(lignes.length, r + 60); i++) {
        const ligneProduit = lignes[i];
        const code = String(ligneProduit[c] ?? "").trim();
        const nomFichier = String(ligneProduit[c + 1] ?? "").trim();

        if (estColonneEntete(ligneProduit[c], ligneProduit[c + 1])) break; // bloc-recette suivant
        if (normaliserTexte(code) === "allergenes") {
          allergenesTexte = nomFichier || null;
          break;
        }
        // Une vraie ligne d'ingrédient a toujours un code (c'est le principe même de ce fichier :
        // rapprocher chaque ingrédient par son code article). Sans code, la cellule "produit" de
        // cette ligne n'est pas un ingrédient : c'est le titre de la recette suivante, dont la
        // cellule fusionnée déborde dans cette colonne au-dessus de son propre bloc — le confondre
        // avec un ingrédient ajoutait silencieusement à chaque recette une fausse ligne "0 × <nom
        // de la recette suivante>". On continue de chercher plus bas (gabarit avec lignes vides).
        if (!code || !nomFichier) continue;

        lignesExtraites.push({
          code,
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
          suggestionsBase: [],
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
    const fusions = feuille["!merges"] ?? [];
    recettes.push(...extraireRecettesFeuille(lignesBrutes, fusions, nomFeuille.trim()));
  }

  ajouterSuggestionsBase(recettes);

  return recettes;
}

// Familles d'assaisonnement de base repérées par mot-clé (peu importe le conditionnement précis,
// ex. "sel" matche aussi bien "SEL FIN 10KG" que "SEL FIN SAL EINVILLE PXM 750G"). Liste courte et
// explicite plutôt que déduite automatiquement, pour rester vérifiable par l'utilisateur.
const FAMILLES_ASSAISONNEMENT_BASE = ["sel", "poivre", "huile", "ail", "oignon", "persil", "laurier", "thym"];

// Une famille n'est proposée comme "de base" que si elle apparaît dans une nette majorité des
// recettes de référence : sinon (ex. huile, ail — souvent absents de plus de la moitié des
// recettes, même dans les feuilles de référence) l'ajouter partout serait faux plus souvent
// qu'utile. Une moyenne calculée sur tout le fichier dilue ce signal (les feuilles où l'ingrédient
// manque justement tirent la moyenne vers le bas), d'où l'usage d'un sous-ensemble de référence.
const SEUIL_PRESENCE_BASE = 0.7;

// Feuilles dont les recettes servent de référence pour ce qu'est un assaisonnement "de base" :
// repérées par mot-clé dans leur nom (insensible aux underscores/accents/casse), plutôt qu'une
// liste figée de noms exacts, pour rester robuste à une légère variation de nommage d'un fichier
// à l'autre.
const MOTS_CLES_FEUILLES_REFERENCE = ["plat", "sauce", "accompagnement"];

function estFeuilleReference(nomFeuille: string): boolean {
  const n = normaliserTexte(nomFeuille);
  return MOTS_CLES_FEUILLES_REFERENCE.some((mot) => n.includes(mot));
}

function familleDe(nomIngredient: string): string | undefined {
  const n = normaliserTexte(nomIngredient);
  return FAMILLES_ASSAISONNEMENT_BASE.find((famille) => n.includes(famille));
}

function mediane(valeurs: number[]): number {
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 === 0 ? (triees[milieu - 1] + triees[milieu]) / 2 : triees[milieu];
}

// Calcule, pour chaque famille suffisamment répandue dans le fichier, une ligne canonique
// (code/nom le plus fréquent, quantité médiane observée) puis l'ajoute en suggestion à chaque
// recette qui n'a aucun ingrédient de cette famille. Modifie `recettes` en place.
function ajouterSuggestionsBase(recettes: RecetteCoutsExtraite[]): void {
  const recettesReference = recettes.filter((r) => estFeuilleReference(r.feuille));
  // Sans feuille de référence identifiable (fichier structuré différemment), on ne devine rien :
  // pas de recettes de référence, pas de suggestion.
  if (recettesReference.length === 0) return;

  const occurrencesParFamille = new Map<string, LigneCoutsExtraite[]>();
  for (const recette of recettesReference) {
    for (const ligne of recette.lignes) {
      const famille = familleDe(ligne.nomFichier);
      if (!famille) continue;
      if (!occurrencesParFamille.has(famille)) occurrencesParFamille.set(famille, []);
      occurrencesParFamille.get(famille)!.push(ligne);
    }
  }

  const suggestionParFamille = new Map<string, LigneCoutsExtraite>();
  for (const [famille, occurrences] of occurrencesParFamille) {
    const nbRecettesAvec = recettesReference.filter((r) =>
      r.lignes.some((l) => familleDe(l.nomFichier) === famille)
    ).length;
    if (nbRecettesAvec / recettesReference.length < SEUIL_PRESENCE_BASE) continue;

    const compteParCode = new Map<string, number>();
    for (const o of occurrences) compteParCode.set(o.code, (compteParCode.get(o.code) ?? 0) + 1);
    const [codeCanonique] = [...compteParCode.entries()].sort((a, b) => b[1] - a[1])[0];
    const referenceCanonique = occurrences.find((o) => o.code === codeCanonique)!;

    const quantites = occurrences.filter((o) => o.quantite > 0).map((o) => o.quantite);
    suggestionParFamille.set(famille, {
      code: codeCanonique,
      nomFichier: referenceCanonique.nomFichier,
      prixFichier: referenceCanonique.prixFichier,
      quantite: mediane(quantites),
    });
  }

  for (const recette of recettes) {
    const famillesPresentes = new Set(
      recette.lignes.map((l) => familleDe(l.nomFichier)).filter((f): f is string => !!f)
    );
    recette.suggestionsBase = [...suggestionParFamille.entries()]
      .filter(([famille]) => !famillesPresentes.has(famille))
      .map(([, suggestion]) => suggestion);
  }
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
