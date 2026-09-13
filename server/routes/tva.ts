import { Router } from "express";

import prisma from "../prisma.js";

const router = Router();

// Liste des taux de TVA
router.get("/", async (_req, res) => {
  const tvas = await prisma.tVA.findMany({
    where: { actif: true },
    orderBy: { taux: "asc" },
  });

  res.json(tvas);
});

// Création d'un taux de TVA
router.post("/", async (req, res) => {
  try {
    const { nom, taux } = req.body;

    const tva = await prisma.tVA.create({ data: { nom, taux } });

    res.status(201).json(tva);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de créer la TVA" });
  }
});

// Modification d'un taux de TVA
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nom, taux } = req.body;

    const tva = await prisma.tVA.update({ where: { id }, data: { nom, taux } });

    res.json(tva);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier la TVA" });
  }
});

// Suppression d'un taux de TVA : refusée si des articles l'utilisent encore
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const nbArticles = await prisma.article.count({ where: { tvaId: id } });

    if (nbArticles > 0) {
      res.status(400).json({
        error: "Ce taux de TVA est utilisé par des ingrédients et ne peut pas être supprimé.",
      });
      return;
    }

    await prisma.tVA.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer la TVA" });
  }
});

export default router;
