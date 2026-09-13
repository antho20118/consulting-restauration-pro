import { Router } from "express";

import prisma from "../prisma.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const depots = await prisma.depot.findMany({
      where: { actif: true },
      orderBy: { nom: "asc" },
    });

    res.json(depots);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les dépôts" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { nom, description, societeId } = req.body;

    const depot = await prisma.depot.create({
      data: { nom, description: description || null, societeId },
    });

    res.status(201).json(depot);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de créer le dépôt" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nom, description } = req.body;

    const depot = await prisma.depot.update({
      where: { id },
      data: { nom, description: description || null },
    });

    res.json(depot);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier le dépôt" });
  }
});

// Suppression douce : le dépôt reste référencé par l'historique des stocks et des mouvements
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    await prisma.depot.update({ where: { id }, data: { actif: false } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer le dépôt" });
  }
});

export default router;
