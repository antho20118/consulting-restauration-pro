export const inclusionsRecette = {
  categorie: true,
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
            include: { unite: true },
          },
          allergenes: {
            include: { allergene: true },
          },
        },
      },
    },
  },
};

// Calcule le coût matière d'une recette à partir du dernier tarif actif de chaque ingrédient,
// en convertissant les unités via leur facteurBase et en tenant compte du rendement de l'article.
// Déduit aussi la liste des allergènes de la recette par union de ceux de ses ingrédients, plutôt
// que de les faire ressaisir manuellement (qui pourrait diverger des ingrédients réellement
// utilisés — une source d'erreur qu'on évite en la calculant).
//
// Calcule également le poids fini (cuit) de la recette : chaque ligne contribue
// quantité × (rendement/100 + gainCuissonPct/100) — le rendement représente ce qui reste de la
// quantité de la ligne après perte, et gainCuissonPct un gain de poids supplémentaire (ex. eau ou
// sauce absorbée), exprimé en % de cette même quantité. Sert à planifier une production : combien
// commander d'ingrédients pour produire une quantité donnée de plat fini (voir RecettesPage).
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
        tarifs: { prixHT: number; unite: { facteurBase: number } }[];
        allergenes: { allergene: { id: number; nom: string } }[];
      };
    }[];
  },
>(recette: T) {
  let coutTotal = 0;
  let poidsFiniTotalG = 0;

  const lignes = recette.lignes.map((ligne) => {
    const tarif = ligne.article.tarifs[0];
    const rendement = ligne.article.rendement || 100;
    const quantiteBase = ligne.quantite * ligne.unite.facteurBase;

    let coutLigne = 0;
    if (tarif) {
      const prixParUniteBase = tarif.prixHT / tarif.unite.facteurBase;
      coutLigne = (quantiteBase * prixParUniteBase) / (rendement / 100);
    }

    const poidsFiniLigneG = quantiteBase * (rendement / 100 + ligne.gainCuissonPct / 100);

    coutTotal += coutLigne;
    poidsFiniTotalG += poidsFiniLigneG;

    return { ...ligne, coutLigne, poidsFiniLigneG };
  });

  const coutParPortion = recette.portions > 0 ? coutTotal / recette.portions : coutTotal;
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
