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
export function calculerCoutRecette<
  T extends {
    portions: number;
    prixVenteHT: number | null;
    lignes: {
      quantite: number;
      unite: { facteurBase: number };
      article: {
        rendement: number;
        tarifs: { prixHT: number; unite: { facteurBase: number } }[];
        allergenes: { allergene: { id: number; nom: string } }[];
      };
    }[];
  },
>(recette: T) {
  let coutTotal = 0;

  const lignes = recette.lignes.map((ligne) => {
    const tarif = ligne.article.tarifs[0];

    let coutLigne = 0;
    if (tarif) {
      const prixParUniteBase = tarif.prixHT / tarif.unite.facteurBase;
      const quantiteBase = ligne.quantite * ligne.unite.facteurBase;
      const rendement = ligne.article.rendement || 100;
      coutLigne = (quantiteBase * prixParUniteBase) / (rendement / 100);
    }

    coutTotal += coutLigne;

    return { ...ligne, coutLigne };
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
  };
}
