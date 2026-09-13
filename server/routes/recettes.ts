import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";
import { calculerCoutRecette, inclusionsRecette } from "../utils/coutRecette.js";

const router = Router();

// Liste des recettes
router.get("/", async (_req: Request, res: Response) => {
  try {
    const recettes = await prisma.recette.findMany({
      where: { actif: true },
      include: inclusionsRecette,
      orderBy: { nom: "asc" },
    });

    res.json(recettes.map(calculerCoutRecette));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les recettes" });
  }
});

// Détail d'une recette
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const recette = await prisma.recette.findUnique({
      where: { id },
      include: inclusionsRecette,
    });

    if (!recette) {
      res.status(404).json({ error: "Recette introuvable" });
      return;
    }

    res.json(calculerCoutRecette(recette));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer la recette" });
  }
});

// Création d'une recette
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      nom,
      categorieId,
      societeId,
      portions,
      prixVenteHT,
      instructions,
      photo,
      lignes,
      etapes,
    } = req.body as {
      nom: string;
      categorieId?: number | null;
      societeId: number;
      portions?: number;
      prixVenteHT?: number | null;
      instructions?: string | null;
      photo?: string | null;
      lignes: { articleId: number; quantite: number; uniteId: number }[];
      etapes?: { description: string; pointCritiqueHACCP: boolean; controleHACCP: string | null }[];
    };

    const recette = await prisma.recette.create({
      data: {
        nom,
        categorieId: categorieId ?? null,
        societeId,
        portions: portions ?? 1,
        prixVenteHT: prixVenteHT ?? null,
        instructions: instructions ?? null,
        photo: photo ?? null,
        lignes: {
          create: (lignes ?? []).map((ligne, index) => ({
            articleId: ligne.articleId,
            quantite: ligne.quantite,
            uniteId: ligne.uniteId,
            ordre: index,
          })),
        },
        etapes: {
          create: (etapes ?? []).map((etape, index) => ({
            description: etape.description,
            pointCritiqueHACCP: etape.pointCritiqueHACCP,
            controleHACCP: etape.controleHACCP,
            ordre: index,
          })),
        },
      },
      include: inclusionsRecette,
    });

    res.status(201).json(calculerCoutRecette(recette));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de créer la recette" });
  }
});

// Mise à jour d'une recette (les lignes et les étapes sont remplacées intégralement)
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const {
      nom,
      categorieId,
      portions,
      prixVenteHT,
      instructions,
      photo,
      lignes,
      etapes,
    } = req.body as {
      nom: string;
      categorieId?: number | null;
      portions?: number;
      prixVenteHT?: number | null;
      instructions?: string | null;
      photo?: string | null;
      lignes: { articleId: number; quantite: number; uniteId: number }[];
      etapes?: { description: string; pointCritiqueHACCP: boolean; controleHACCP: string | null }[];
    };

    const recette = await prisma.$transaction(async (tx) => {
      await tx.recetteLigne.deleteMany({ where: { recetteId: id } });
      await tx.recetteEtape.deleteMany({ where: { recetteId: id } });

      return tx.recette.update({
        where: { id },
        data: {
          nom,
          categorieId: categorieId ?? null,
          portions: portions ?? 1,
          prixVenteHT: prixVenteHT ?? null,
          instructions: instructions ?? null,
          photo: photo ?? null,
          lignes: {
            create: (lignes ?? []).map((ligne, index) => ({
              articleId: ligne.articleId,
              quantite: ligne.quantite,
              uniteId: ligne.uniteId,
              ordre: index,
            })),
          },
          etapes: {
            create: (etapes ?? []).map((etape, index) => ({
              description: etape.description,
              pointCritiqueHACCP: etape.pointCritiqueHACCP,
              controleHACCP: etape.controleHACCP,
              ordre: index,
            })),
          },
        },
        include: inclusionsRecette,
      });
    });

    res.json(calculerCoutRecette(recette));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de mettre à jour la recette" });
  }
});

// Suppression (douce) d'une recette
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    await prisma.recette.update({ where: { id }, data: { actif: false } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer la recette" });
  }
});

export default router;
