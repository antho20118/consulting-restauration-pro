import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";

const router = Router();

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

// Enregistre un mouvement (entrée ou sortie) et ajuste le stock du dépôt principal en conséquence.
router.post("/", async (req: Request, res: Response) => {
  try {
    const { articleId, type, quantite, motif } = req.body as {
      articleId: number;
      type: "ENTREE" | "SORTIE";
      quantite: number;
      motif?: string;
    };

    if (quantite <= 0) {
      res.status(400).json({ error: "La quantité doit être supérieure à zéro" });
      return;
    }

    const mouvement = await prisma.$transaction(async (tx) => {
      const article = await tx.article.findUniqueOrThrow({ where: { id: articleId } });

      const depot = await tx.depot.findFirst({ where: { societeId: article.societeId } });
      if (!depot) {
        throw new Error("Aucun dépôt configuré pour cette société");
      }

      const delta = type === "ENTREE" ? quantite : -quantite;

      const stockActuel = await tx.stock.findUnique({
        where: { articleId_depotId: { articleId, depotId: depot.id } },
      });

      const nouvelleQuantite = (stockActuel?.quantite ?? 0) + delta;
      if (nouvelleQuantite < 0) {
        throw new StockInsuffisantError();
      }

      await tx.stock.upsert({
        where: { articleId_depotId: { articleId, depotId: depot.id } },
        update: { quantite: nouvelleQuantite },
        create: { articleId, depotId: depot.id, quantite: nouvelleQuantite },
      });

      return tx.mouvementStock.create({
        data: {
          articleId,
          depotId: depot.id,
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
