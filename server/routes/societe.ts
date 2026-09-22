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
    const { nom, coefficientMultiplicateur } = req.body as {
      nom: string;
      coefficientMultiplicateur?: number | null;
    };

    // Nullable, jamais de valeur par défaut : tant que ce champ n'est pas explicitement saisi (ou
    // explicitement effacé, en renvoyant null), l'agent Consulting ne doit simuler aucun prix de
    // vente ni food cost théorique — voir server/routes/consulting.ts.
    if (
      coefficientMultiplicateur != null &&
      (!Number.isFinite(coefficientMultiplicateur) || coefficientMultiplicateur <= 0)
    ) {
      res.status(400).json({ error: "Coefficient multiplicateur invalide" });
      return;
    }

    const societe = await prisma.societe.update({
      where: { id },
      data: { nom, coefficientMultiplicateur: coefficientMultiplicateur ?? null },
    });

    res.json(societe);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier la société" });
  }
});

export default router;
