import { versUniteBase } from "./uniteConversion.js";

export const inclusionsRecette = {
  categorie: true,
  sousCategorie: true,
  etapes: {
    orderBy: { ordre: "asc" as const },
  },
  lignes: {
    orderBy: { ordre: "asc" as const },
    include: {
      unite: true,
      article: {
        include: {
          tarifs: {
            where: { actif: true },
            orderBy: { dateDebut: "desc" as const },
            take: 1,
            include: { unite: true, conditionnement: true },
          },
          allergenes: {
            include: { allergene: true },
          },
          nutrition: true,
        },
      },
    },
  },
};

// Les 8 valeurs nutritionnelles stockées (voir ValeurNutritionnelle, prisma/schema.prisma),
// saisies "pour 100g" de l'unité de base de l'article — même convention qu'une étiquette
// nutritionnelle réelle. Regroupées ici pour n'énumérer cette liste qu'une seule fois.
export const CHAMPS_NUTRITION = [
  "energie",
  "proteines",
  "glucides",
  "sucres",
  "lipides",
  "acidesGrasSatures",
  "fibres",
  "sel",
] as const;
export type ChampNutrition = (typeof CHAMPS_NUTRITION)[number];
export type ValeursNutritionnelles = Record<ChampNutrition, number>;
type NutritionArticle = Partial<Record<ChampNutrition, number | null>> | null;

type TarifCout = {
  prixHT: number;
  quantiteConditionnement: number;
  unite: { facteurBase: number };
};

/**
 * Prix du tarif ramené à une unité de base.
 *
 * Convention métier : prixHT est le prix HT du conditionnement et
 * quantiteConditionnement est la quantité de l'unité tarifaire contenue dans ce
 * conditionnement. Exemple : 65 € pour un carton de 10 kg => 6,50 €/kg.
 * Une quantiteConditionnement de 1 conserve la compatibilité avec les anciens
 * tarifs qui stockaient déjà un prix unitaire.
 */
export function prixParUniteBase(tarif: TarifCout): number {
  if (!Number.isFinite(tarif.prixHT) || tarif.prixHT < 0) {
    throw new Error("Prix HT invalide");
  }
  if (!Number.isFinite(tarif.quantiteConditionnement) || tarif.quantiteConditionnement <= 0) {
    throw new Error("Quantité de conditionnement invalide");
  }
  if (!Number.isFinite(tarif.unite.facteurBase) || tarif.unite.facteurBase <= 0) {
    throw new Error("Facteur d'unité invalide");
  }

  return tarif.prixHT / (tarif.quantiteConditionnement * tarif.unite.facteurBase);
}

function rendementValide(rendement: number): number {
  if (!Number.isFinite(rendement) || rendement <= 0 || rendement > 1000) {
    throw new Error("Rendement article invalide");
  }
  return rendement;
}

// Calcule le coût matière d'une recette à partir du dernier tarif actif de chaque ingrédient,
// en normalisant explicitement le prix du conditionnement, puis en convertissant la quantité
// de recette vers la même unité de base. Déduit aussi la liste des allergènes de la recette par
// union de ceux de ses ingrédients.
//
// Convention métier (décision du 15/10) : la quantité saisie est le poids BRUT, tel qu'acheté
// (ex. 1 kg de pommes de terre non épluchées). Le rendement de l'article (part utilisable après
// épluchage/parage) ne réduit donc QUE le poids fini et la part consommée (nutrition), jamais le
// coût — il n'est ainsi compté qu'une fois dans le prix de revient au kilo fini (avant, il l'était
// deux fois : coût divisé par le rendement ET poids fini réduit).
//
// Le coût d'un ingrédient suit donc :
// quantité brute en unité de base × prix du conditionnement / quantité du conditionnement /
// facteur de l'unité tarifaire.
// Exemple : 1 kg de pommes de terre à 10 €/kg, rendement 80 % => 10 €, 800 g finis, soit
// 12,50 €/kg fini (coutParKgFini).
//
// Type de retour annoté explicitement (plutôt que laissé à l'inférence) : sans cette annotation,
// TypeScript n'arrive pas à faire remonter coutLigne/poidsFiniLigneG (ajoutés dans le corps de la
// fonction, voir `const lignes = recette.lignes.map(...)` ci-dessous) jusqu'au type public de
// chaque ligne pour un appelant qui référence ce type depuis un autre fichier (voir
// server/utils/pdf/ficheRecettePdf.tsx) — un simple accès `.coutLigne` y était vu comme une
// propriété inexistante malgré la donnée bien présente à l'exécution.
export function calculerCoutRecette<
  T extends {
    portions: number;
    prixVenteHT: number | null;
    lignes: {
      quantite: number;
      unite: { facteurBase: number };
      gainCuissonPct: number;
      article: {
        rendement: number;
        tarifs: TarifCout[];
        allergenes: { allergene: { id: number; nom: string } }[];
        nutrition: NutritionArticle;
      };
    }[];
  },
>(
  recette: T
): Omit<T, "lignes"> & {
  lignes: (T["lignes"][number] & { coutLigne: number; poidsFiniLigneG: number })[];
  coutTotal: number;
  coutParPortion: number;
  foodCostPct: number | null;
  margeHT: number | null;
  allergenes: { id: number; nom: string }[];
  poidsFiniTotalG: number;
  coutParKgFini: number | null;
  valeursNutritionnelles: ValeursNutritionnelles;
  nutritionIncomplete: boolean;
} {
  let coutTotal = 0;
  let poidsFiniTotalG = 0;
  // Calculées sur la part réellement consommée (quantité brute × rendement) : les pertes de
  // préparation (épluchures, parures) ne sont jamais mangées, donc jamais comptées dans les
  // valeurs nutritionnelles du plat fini. Un rendement supérieur à 100 % (ex. riz sec qui absorbe
  // de l'eau) ou le gain de cuisson n'apportent aucune valeur nutritionnelle : facteur plafonné à
  // 100 %.
  const nutritionTotal: ValeursNutritionnelles = Object.fromEntries(
    CHAMPS_NUTRITION.map((c) => [c, 0])
  ) as ValeursNutritionnelles;
  // true dès qu'au moins un ingrédient utilisé n'a aucune valeur nutritionnelle saisie (ligne
  // entière absente) ou qu'un des 8 champs est resté vide sur un ingrédient qui en a d'autres —
  // jamais silencieusement traité comme 0 sans le signaler : les valeurs affichées restent une
  // approximation par défaut tant que la fiche ingrédient n'est pas complétée.
  let nutritionIncomplete = false;

  if (!Number.isFinite(recette.portions) || recette.portions <= 0) {
    throw new Error("Nombre de portions invalide");
  }

  const lignes = recette.lignes.map((ligne) => {
    const tarif = ligne.article.tarifs[0];
    const rendement = rendementValide(ligne.article.rendement);
    const quantiteBase = versUniteBase(ligne.quantite, ligne.unite);

    let coutLigne = 0;
    if (tarif) {
      const prixUnitaireBase = prixParUniteBase(tarif);
      coutLigne = quantiteBase * prixUnitaireBase;
    }

    const poidsFiniLigneG =
      quantiteBase * (rendement / 100 + ligne.gainCuissonPct / 100);

    coutTotal += coutLigne;
    poidsFiniTotalG += poidsFiniLigneG;

    if (!ligne.article.nutrition) {
      nutritionIncomplete = true;
    } else {
      for (const champ of CHAMPS_NUTRITION) {
        const valeur = ligne.article.nutrition[champ];
        if (valeur == null) {
          nutritionIncomplete = true;
          continue;
        }
        nutritionTotal[champ] += quantiteBase * (Math.min(rendement, 100) / 100) * (valeur / 100);
      }
    }

    return { ...ligne, coutLigne, poidsFiniLigneG };
  });

  // recette.portions est garanti > 0 par la validation ci-dessus.
  const coutParPortion = coutTotal / recette.portions;
  const foodCostPct =
    recette.prixVenteHT && recette.prixVenteHT > 0
      ? (coutParPortion / recette.prixVenteHT) * 100
      : null;
  const margeHT = recette.prixVenteHT != null ? recette.prixVenteHT - coutParPortion : null;

  const allergenes = allergenesDeLaRecette(recette.lignes);

  // recette.portions est garanti > 0 par la validation ci-dessus.
  const valeursNutritionnelles: ValeursNutritionnelles = Object.fromEntries(
    CHAMPS_NUTRITION.map((c) => [c, nutritionTotal[c] / recette.portions])
  ) as ValeursNutritionnelles;

  return {
    ...recette,
    lignes,
    coutTotal,
    coutParPortion,
    foodCostPct,
    margeHT,
    allergenes,
    poidsFiniTotalG,
    // Prix de revient au kilo de recette finie : null sans poids fini (aucune ligne).
    coutParKgFini: poidsFiniTotalG > 0 ? coutTotal / (poidsFiniTotalG / 1000) : null,
    valeursNutritionnelles,
    nutritionIncomplete,
  };
}

// Union des allergènes des ingrédients, triée par nom — indépendante du coût : reste calculable
// même quand le coût ne l'est pas (voir calculerCoutRecetteOuSignaler).
function allergenesDeLaRecette(
  lignes: { article: { allergenes: { allergene: { id: number; nom: string } }[] } }[]
): { id: number; nom: string }[] {
  const allergenesParId = new Map<number, string>();
  for (const ligne of lignes) {
    for (const { allergene } of ligne.article.allergenes) {
      allergenesParId.set(allergene.id, allergene.nom);
    }
  }
  return Array.from(allergenesParId, ([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom));
}

// Pour l'AFFICHAGE d'une recette déjà enregistrée (liste, fiche, tableau de bord) : une recette dont
// le coût ne peut pas être calculé (ex. 0 portion, enregistrée avant que la création ne le
// vérifie) n'est jamais retirée silencieusement ni remplacée par une erreur 500 — elle est renvoyée
// signalée par calculImpossible (le motif), coûts à 0 et food cost/marge à null (exclus des
// moyennes), pour que l'utilisateur la voie et puisse la corriger. Ses allergènes restent calculés :
// information de sécurité, jamais masquée faute de prix. La création et la modification gardent
// calculerCoutRecette, strict (une recette incalculable y est refusée).
export function calculerCoutRecetteOuSignaler<T extends Parameters<typeof calculerCoutRecette>[0]>(
  recette: T
): ReturnType<typeof calculerCoutRecette<T>> & { calculImpossible?: string } {
  try {
    return calculerCoutRecette(recette);
  } catch (error) {
    return {
      ...recette,
      lignes: recette.lignes.map((ligne) => ({ ...ligne, coutLigne: 0, poidsFiniLigneG: 0 })),
      coutTotal: 0,
      coutParPortion: 0,
      foodCostPct: null,
      margeHT: null,
      allergenes: allergenesDeLaRecette(recette.lignes),
      poidsFiniTotalG: 0,
      coutParKgFini: null,
      valeursNutritionnelles: Object.fromEntries(CHAMPS_NUTRITION.map((c) => [c, 0])) as ValeursNutritionnelles,
      nutritionIncomplete: true,
      calculImpossible: error instanceof Error ? error.message : "Calcul impossible",
    };
  }
}

// Pour une LISTE de recettes servant à une ANALYSE de coûts (ventes, questions-réponses) : une
// recette au coût incalculable en est écartée (elle fausserait marges et moyennes), sans faire
// échouer l'analyse des autres. Pour l'AFFICHAGE des recettes, voir calculerCoutRecetteOuSignaler,
// qui ne retire jamais une recette.
export function calculerCoutsRecettesSansErreur<T extends Parameters<typeof calculerCoutRecette>[0]>(
  recettes: T[]
): ReturnType<typeof calculerCoutRecette<T>>[] {
  return recettes.flatMap((recette) => {
    try {
      return [calculerCoutRecette(recette)];
    } catch (error) {
      console.error(`Recette invalide ignorée dans la liste (id ${(recette as { id?: unknown }).id})`, error);
      return [];
    }
  });
}
