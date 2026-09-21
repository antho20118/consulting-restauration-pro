import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";

const router = Router();

const schemaMouvement = z.object({
  articleId: z.number().int().positive(),
  depotId: z.number().int().positive(),
  type: z.enum(["ENTREE", "SORTIE"]),
  quantite: z.number().finite().positive(),
  motif: z.string().trim().max(500).optional(),
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    const mouvements = await prisma.mouvementStock.findMany({
      include: {
        article: true,
        depot: true,
      },
      orderBy: { date: "desc" },
    });

    res.json(mouvements);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les mouvements de stock" });
  }
});

// Enregistre un mouvement (entrée ou sortie) et ajuste le stock du dépôt choisi en conséquence.
router.post("/", async (req: Request, res: Response) => {
  try {
    const analyse = schemaMouvement.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Mouvement de stock invalide", details: analyse.error.flatten() });
      return;
    }
    const { articleId, depotId, type, quantite, motif } = analyse.data;

    const mouvement = await prisma.$transaction(async (tx) => {
      await tx.article.findUniqueOrThrow({ where: { id: articleId } });
      await tx.depot.findUniqueOrThrow({ where: { id: depotId } });

      const delta = type === "ENTREE" ? quantite : -quantite;

      const stockActuel = await tx.stock.findUnique({
        where: { articleId_depotId: { articleId, depotId } },
      });

      const nouvelleQuantite = (stockActuel?.quantite ?? 0) + delta;
      if (nouvelleQuantite < 0) {
        throw new StockInsuffisantError();
      }

      await tx.stock.upsert({
        where: { articleId_depotId: { articleId, depotId } },
        update: { quantite: nouvelleQuantite },
        create: { articleId, depotId, quantite: nouvelleQuantite },
      });

      return tx.mouvementStock.create({
        data: {
          articleId,
          depotId,
          type,
          quantite,
          motif: motif || null,
        },
        include: { article: true, depot: true },
      });
    });

    res.status(201).json(mouvement);
  } catch (error) {
    if (error instanceof StockInsuffisantError) {
      res.status(400).json({ error: "Stock insuffisant pour cette sortie" });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "Impossible d'enregistrer le mouvement de stock" });
  }
});

class StockInsuffisantError extends Error {}

export default router;
