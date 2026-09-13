import { Router } from "express";

import prisma from "../prisma.js";

const router = Router();

// L'application est mono-société : on renvoie la première (et normalement unique) société
router.get("/", async (_req, res) => {
  try {
    const societe = await prisma.societe.findFirst({ orderBy: { id: "asc" } });
    res.json(societe);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les informations de la société" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nom } = req.body;

    const societe = await prisma.societe.update({ where: { id }, data: { nom } });

    res.json(societe);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier la société" });
  }
});

export default router;
