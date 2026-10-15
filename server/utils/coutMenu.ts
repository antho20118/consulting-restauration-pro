import { calculerCoutRecette, calculerCoutRecetteOuSignaler, inclusionsRecette } from "./coutRecette.js";
import type { ChampNutrition } from "./coutRecette.js";

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
      nutrition: Partial<Record<ChampNutrition, number | null>> | null;
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

// Pour l'AFFICHAGE d'un menu déjà enregistré (liste, détail) : un menu contenant une recette au
// coût incalculable n'est jamais retiré silencieusement de la liste (ni remplacé par une erreur
// 500) — il est renvoyé signalé par calculImpossible (la recette en cause et le motif), coût à 0 et
// food cost/marge à null. La création et la modification gardent calculerCoutMenu, strict.
export function calculerCoutMenuOuSignaler<T extends Parameters<typeof calculerCoutMenu>[0]>(
  menu: T
): ReturnType<typeof calculerCoutMenu<T>> & { calculImpossible?: string } {
  try {
    return calculerCoutMenu(menu);
  } catch (error) {
    const lignes = menu.lignes.map((ligne) => {
      const recette = calculerCoutRecetteOuSignaler(ligne.recette);
      return { ...ligne, recette, coutLigne: recette.calculImpossible ? 0 : recette.coutParPortion * ligne.quantite };
    });
    const enCause = lignes.find((ligne) => ligne.recette.calculImpossible);
    const nomEnCause = (enCause?.recette as { nom?: string } | undefined)?.nom;
    return {
      ...menu,
      lignes,
      coutTotal: 0,
      foodCostPct: null,
      margeHT: null,
      calculImpossible: enCause
        ? `Recette${nomEnCause ? ` « ${nomEnCause} »` : ""} : ${enCause.recette.calculImpossible}`
        : error instanceof Error
          ? error.message
          : "Calcul impossible",
    };
  }
}
