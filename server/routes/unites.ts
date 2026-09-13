import { Router } from "express";

import prisma from "../prisma.js";

const router = Router();

// Liste des unités
router.get("/", async (_req, res) => {
  const unites = await prisma.unite.findMany({
    where: { actif: true },
    orderBy: { nom: "asc" },
  });

  res.json(unites);
});

// Création d'une unité
router.post("/", async (req, res) => {
  try {
    const { nom, symbole, type, facteurBase } = req.body;

    const unite = await prisma.unite.create({ data: { nom, symbole, type, facteurBase } });

    res.status(201).json(unite);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de créer l'unité" });
  }
});

// Modification d'une unité
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nom, symbole, type, facteurBase } = req.body;

    const unite = await prisma.unite.update({
      where: { id },
      data: { nom, symbole, type, facteurBase },
    });

    res.json(unite);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier l'unité" });
  }
});

// Suppression d'une unité : refusée si des tarifs ou des lignes de recette l'utilisent encore
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [nbTarifs, nbLignes] = await Promise.all([
      prisma.tarifArticle.count({ where: { uniteId: id } }),
      prisma.recetteLigne.count({ where: { uniteId: id } }),
    ]);

    if (nbTarifs > 0 || nbLignes > 0) {
      res.status(400).json({
        error:
          "Cette unité est utilisée par des tarifs ou des lignes de recette et ne peut pas être supprimée.",
      });
      return;
    }

    await prisma.unite.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer l'unité" });
  }
});

export default router;
