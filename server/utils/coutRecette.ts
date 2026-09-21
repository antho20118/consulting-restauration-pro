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
        },
      },
    },
  },
};

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
// de recette vers la même unité de base et en tenant compte du rendement de l'article.
// Déduit aussi la liste des allergènes de la recette par union de ceux de ses ingrédients.
//
// Le coût d'un ingrédient suit donc :
// quantité recette en unité de base × prix du conditionnement / quantité du conditionnement /
// facteur de l'unité tarifaire / rendement.
// Exemple : 1 kg utilisé, carton 10 kg à 65 €, rendement 100 % => 6,50 €.
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
      };
    }[];
  },
>(recette: T) {
  let coutTotal = 0;
  let poidsFiniTotalG = 0;

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
      coutLigne = (quantiteBase * prixUnitaireBase) / (rendement / 100);
    }

    const poidsFiniLigneG =
      quantiteBase * (rendement / 100 + ligne.gainCuissonPct / 100);

    coutTotal += coutLigne;
    poidsFiniTotalG += poidsFiniLigneG;

    return { ...ligne, coutLigne, poidsFiniLigneG };
  });

  // recette.portions est garanti > 0 par la validation ci-dessus.
  const coutParPortion = coutTotal / recette.portions;
  const foodCostPct =
    recette.prixVenteHT && recette.prixVenteHT > 0
      ? (coutParPortion / recette.prixVenteHT) * 100
      : null;
  const margeHT = recette.prixVenteHT != null ? recette.prixVenteHT - coutParPortion : null;

  const allergenesParId = new Map<number, string>();
  for (const ligne of recette.lignes) {
    for (const { allergene } of ligne.article.allergenes) {
      allergenesParId.set(allergene.id, allergene.nom);
    }
  }
  const allergenes = Array.from(allergenesParId, ([id, nom]) => ({ id, nom })).sort((a, b) =>
    a.nom.localeCompare(b.nom)
  );

  return {
    ...recette,
    lignes,
    coutTotal,
    coutParPortion,
    foodCostPct,
    margeHT,
    allergenes,
    poidsFiniTotalG,
  };
}

// Pour une LISTE de recettes (tableau de bord, liste des fiches) : une donnée invalide sur une
// seule recette (rendement à 0, conditionnement mal renseigné...) ne doit pas faire échouer
// l'affichage de toutes les autres. calculerCoutRecette reste strict (throw) pour une recette
// individuelle (détail, création, modification), où l'erreur doit être visible immédiatement.
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
