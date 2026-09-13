import { Router } from "express";

import prisma from "../prisma.js";

const router = Router();

// Liste des catégories de recettes
router.get("/", async (_req, res) => {
  const categories = await prisma.categorieRecette.findMany({
    orderBy: {
      nom: "asc",
    },
  });

  res.json(categories);
});

// Création d'une catégorie de recette
router.post("/", async (req, res) => {
  try {
    const { nom } = req.body;

    const categorie = await prisma.categorieRecette.create({
      data: {
        nom,
      },
    });

    res.status(201).json(categorie);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de créer la catégorie de recette" });
  }
});

// Renommage d'une catégorie de recette
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nom } = req.body;

    const categorie = await prisma.categorieRecette.update({ where: { id }, data: { nom } });

    res.json(categorie);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier la catégorie de recette" });
  }
});

// Suppression d'une catégorie de recette : refusée si des recettes l'utilisent encore
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const nbRecettes = await prisma.recette.count({ where: { categorieId: id } });

    if (nbRecettes > 0) {
      res.status(400).json({
        error: "Cette catégorie est utilisée par des recettes et ne peut pas être supprimée.",
      });
      return;
    }

    await prisma.categorieRecette.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer la catégorie de recette" });
  }
});

export default router;
