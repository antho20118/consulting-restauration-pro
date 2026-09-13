import { Router } from "express";

import prisma from "../prisma.js";

const router = Router();

// Liste des catégories
router.get("/", async (_req, res) => {
  const categories = await prisma.categorie.findMany({
    orderBy: {
      nom: "asc",
    },
  });

  res.json(categories);
});

// Création d'une catégorie
router.post("/", async (req, res) => {
  try {
    const { nom } = req.body;

    const categorie = await prisma.categorie.create({
      data: {
        nom,
      },
    });

    res.status(201).json(categorie);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de créer la catégorie" });
  }
});

// Renommage d'une catégorie
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nom } = req.body;

    const categorie = await prisma.categorie.update({ where: { id }, data: { nom } });

    res.json(categorie);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier la catégorie" });
  }
});

// Suppression d'une catégorie : refusée si des articles l'utilisent encore
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const nbArticles = await prisma.article.count({ where: { categorieId: id } });

    if (nbArticles > 0) {
      res.status(400).json({
        error: "Cette catégorie est utilisée par des ingrédients et ne peut pas être supprimée.",
      });
      return;
    }

    await prisma.categorie.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer la catégorie" });
  }
});

export default router;
