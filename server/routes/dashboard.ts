import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";
import { calculerCoutRecette, inclusionsRecette } from "../utils/coutRecette.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const [nbIngredients, recettesBrutes, stocks] = await Promise.all([
      prisma.article.count({ where: { actif: true } }),
      prisma.recette.findMany({ where: { actif: true }, include: inclusionsRecette }),
      prisma.stock.findMany({
        include: {
          article: {
            include: {
              tarifs: { where: { actif: true }, orderBy: { dateDebut: "desc" }, take: 1 },
            },
          },
        },
      }),
    ]);

    const recettes = recettesBrutes.map(calculerCoutRecette);

    const valeurStock = stocks.reduce((total, stock) => {
      const tarif = stock.article.tarifs[0];
      return total + (tarif ? stock.quantite * tarif.prixHT : 0);
    }, 0);

    const foodCostValues = recettes
      .map((recette) => recette.foodCostPct)
      .filter((valeur): valeur is number => valeur != null);
    const foodCostMoyen =
      foodCostValues.length > 0
        ? foodCostValues.reduce((total, valeur) => total + valeur, 0) / foodCostValues.length
        : null;

    // Seuil "Bon" du statut food cost (voir src/features/dashboard/utils/statutFoodCost.ts, à
    // garder synchronisé) : ne remonter en alerte que les recettes qui en ont réellement besoin,
    // plutôt que systématiquement les 5 recettes les plus chères même quand tout va bien.
    const SEUIL_FOOD_COST_BON = 28;
    const recettesAlerte = recettes
      .filter((recette) => recette.foodCostPct != null && recette.foodCostPct > SEUIL_FOOD_COST_BON)
      .sort((a, b) => (b.foodCostPct ?? 0) - (a.foodCostPct ?? 0))
      .slice(0, 10)
      .map((recette) => ({
        id: recette.id,
        nom: recette.nom,
        foodCostPct: recette.foodCostPct as number,
        coutParPortion: recette.coutParPortion,
        prixVenteHT: recette.prixVenteHT as number,
      }));

    const compteurParCategorie = new Map<string, number>();
    for (const recette of recettes) {
      const nom = recette.categorie?.nom ?? "Sans catégorie";
      compteurParCategorie.set(nom, (compteurParCategorie.get(nom) ?? 0) + 1);
    }
    const repartitionCategories = Array.from(compteurParCategorie, ([categorie, count]) => ({
      categorie,
      count,
    })).sort((a, b) => b.count - a.count);

    res.json({
      nbIngredients,
      nbRecettes: recettes.length,
      valeurStock,
      foodCostMoyen,
      recettesAlerte,
      repartitionCategories,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de calculer les indicateurs du tableau de bord" });
  }
});

export default router;
