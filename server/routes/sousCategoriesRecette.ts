import { Router } from "express";

import prisma from "../prisma.js";

const router = Router();

// Liste des sous-catégories de recettes (type d'ingrédient principal)
router.get("/", async (_req, res) => {
  const sousCategories = await prisma.sousCategorieRecette.findMany({
    orderBy: {
      nom: "asc",
    },
  });

  res.json(sousCategories);
});

// Création d'une sous-catégorie de recette
router.post("/", async (req, res) => {
  try {
    const { nom, parentId } = req.body as { nom: string; parentId?: number | null };

    const sousCategorie = await prisma.sousCategorieRecette.create({
      data: {
        nom,
        parentId: parentId ?? null,
      },
    });

    res.status(201).json(sousCategorie);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de créer la sous-catégorie de recette" });
  }
});

// Renommage d'une sous-catégorie de recette
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nom, parentId } = req.body as { nom: string; parentId?: number | null };

    const sousCategorie = await prisma.sousCategorieRecette.update({
      where: { id },
      data: { nom, parentId: parentId ?? null },
    });

    res.json(sousCategorie);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier la sous-catégorie de recette" });
  }
});

// Suppression d'une sous-catégorie de recette : refusée si des recettes l'utilisent encore
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const nbRecettes = await prisma.recette.count({ where: { sousCategorieId: id } });

    if (nbRecettes > 0) {
      res.status(400).json({
        error: "Cette sous-catégorie est utilisée par des recettes et ne peut pas être supprimée.",
      });
      return;
    }

    await prisma.sousCategorieRecette.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer la sous-catégorie de recette" });
  }
});

export default router;
