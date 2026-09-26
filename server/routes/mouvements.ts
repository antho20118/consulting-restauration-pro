import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import prisma from "../prisma.js";
import { libelleUniteBase } from "../utils/uniteConversion.js";

const router = Router();

const schemaMouvement = z.object({
  articleId: z.number().int().positive(),
  depotId: z.number().int().positive(),
  type: z.enum(["ENTREE", "SORTIE"]),
  quantite: z.number().finite().positive(),
  motif: z.string().trim().max(500).optional(),
});

// Stock.quantite (et donc MouvementStock.quantite) est toujours exprimée dans l'unité de base de
// l'article (voir versUniteBase), jamais dans l'unité d'achat du tarif (ex. « carton de 6kg ») —
// c'est cette unité de base, dérivée du tarif actif, qu'il faut afficher à côté de la quantité
// pour que la saisie et l'historique ne soient jamais ambigus.
const inclusionArticleAvecUnite = {
  include: {
    tarifs: {
      where: { actif: true },
      orderBy: { dateDebut: "desc" as const },
      take: 1,
      include: { unite: true },
    },
  },
};

function mouvementAvecUniteBase<T extends { article: { tarifs: { unite: { type: string } }[] } }>(
  mouvement: T
) {
  return {
    ...mouvement,
    article: { ...mouvement.article, uniteBase: libelleUniteBase(mouvement.article.tarifs[0]?.unite.type) },
  };
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const mouvements = await prisma.mouvementStock.findMany({
      include: {
        article: inclusionArticleAvecUnite,
        depot: true,
      },
      orderBy: { date: "desc" },
    });

    res.json(mouvements.map(mouvementAvecUniteBase));
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
        include: { article: inclusionArticleAvecUnite, depot: true },
      });
    });

    res.status(201).json(mouvementAvecUniteBase(mouvement));
  } catch (error) {
    if (error instanceof StockInsuffisantError) {
      res.status(400).json({ error: "Stock insuffisant pour cette sortie" });
      return;
    }

    // articleId/depotId inexistant (voir les findUniqueOrThrow ci-dessus) : Prisma lève P2025, une
    // erreur prévisible côté appelant, jamais une panne serveur — traitement local à ce seul
    // routeur (voir caractérisation dédiée « P2025, POST /mouvements »), sans toucher au helper
    // partagé server/utils/erreursEcriture.ts (P2003 uniquement).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      console.error(error);
      res.status(400).json({ error: "Référence invalide : un champ désigne un enregistrement inexistant" });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "Impossible d'enregistrer le mouvement de stock" });
  }
});

class StockInsuffisantError extends Error {}

export default router;
