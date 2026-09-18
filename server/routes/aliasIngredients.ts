import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";
import { normaliserTexte } from "../utils/normaliserTexte.js";

const router = Router();

// Liste complète des correspondances mémorisées (texte d'ingrédient -> article), utilisée côté
// client pour pré-remplir automatiquement l'import d'une recette (voir ImporterRecetteModal.tsx).
// Table de taille modeste par nature (un alias par formulation d'ingrédient déjà rencontrée) :
// pas besoin de pagination.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const alias = await prisma.aliasIngredientImport.findMany({
      select: { texteNormalise: true, articleId: true },
    });

    res.json(alias);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les correspondances d'ingrédients" });
  }
});

// Mémorise (ou met à jour) les correspondances texte -> article passées en masse. Appelée à
// l'enregistrement d'une recette pour chaque ligne provenant d'un import texte/photo (voir
// RecetteForm.tsx), afin que la prochaine recette important le même ingrédient retrouve
// directement le bon article. Volontairement permissive (upsert, pas de vérification que
// l'article existe encore) : une correspondance obsolète sera simplement ignorée si l'article a
// depuis été désactivé, sans faire échouer l'enregistrement de la recette qui l'a déclenchée.
router.post("/", async (req: Request, res: Response) => {
  try {
    const { correspondances } = req.body as {
      correspondances: { texte: string; articleId: number }[];
    };

    const aTraiter = (correspondances ?? []).filter((c) => c.texte?.trim() && c.articleId);

    await Promise.all(
      aTraiter.map((c) => {
        const texteNormalise = normaliserTexte(c.texte);
        if (!texteNormalise) return null;

        return prisma.aliasIngredientImport.upsert({
          where: { texteNormalise },
          create: { texteNormalise, articleId: c.articleId },
          update: { articleId: c.articleId },
        });
      })
    );

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible d'enregistrer les correspondances d'ingrédients" });
  }
});

export default router;
