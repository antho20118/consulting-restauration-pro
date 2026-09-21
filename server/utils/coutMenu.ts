import { calculerCoutRecette, inclusionsRecette } from "./coutRecette.js";

export const inclusionsMenu = {
  categorie: true,
  lignes: {
    orderBy: { ordre: "asc" as const },
    include: {
      recette: {
        include: {
          lignes: inclusionsRecette.lignes,
        },
      },
    },
  },
};

type RecetteAvecLignes = {
  portions: number;
  prixVenteHT: number | null;
  lignes: {
    quantite: number;
    unite: { facteurBase: number };
    gainCuissonPct: number;
    article: {
      rendement: number;
      tarifs: { prixHT: number; quantiteConditionnement: number; unite: { facteurBase: number } }[];
      allergenes: { allergene: { id: number; nom: string } }[];
    };
  }[];
};

// Calcule le coût matière d'un menu à partir du coût par portion de chaque recette qui le
// compose (Entrée + Plat + Dessert, par exemple), multiplié par la quantité de cette recette
// incluse dans le menu — sur le même principe qu'une recette déduit le sien de ses articles.
export function calculerCoutMenu<
  T extends {
    prixVenteHT: number | null;
    lignes: {
      quantite: number;
      recette: RecetteAvecLignes;
    }[];
  },
>(menu: T) {
  let coutTotal = 0;

  const lignes = menu.lignes.map((ligne) => {
    const recetteAvecCout = calculerCoutRecette(ligne.recette);
    const coutLigne = recetteAvecCout.coutParPortion * ligne.quantite;

    coutTotal += coutLigne;

    return { ...ligne, recette: recetteAvecCout, coutLigne };
  });

  const foodCostPct =
    menu.prixVenteHT && menu.prixVenteHT > 0 ? (coutTotal / menu.prixVenteHT) * 100 : null;
  const margeHT = menu.prixVenteHT != null ? menu.prixVenteHT - coutTotal : null;

  return {
    ...menu,
    lignes,
    coutTotal,
    foodCostPct,
    margeHT,
  };
}

// Pour une LISTE de menus : une recette invalide dans un seul menu ne doit pas faire échouer
// l'affichage de tous les autres (même raisonnement que calculerCoutsRecettesSansErreur).
export function calculerCoutsMenusSansErreur<T extends Parameters<typeof calculerCoutMenu>[0]>(
  menus: T[]
): ReturnType<typeof calculerCoutMenu<T>>[] {
  return menus.flatMap((menu) => {
    try {
      return [calculerCoutMenu(menu)];
    } catch (error) {
      console.error(`Menu invalide ignoré dans la liste (id ${(menu as { id?: unknown }).id})`, error);
      return [];
    }
  });
}
