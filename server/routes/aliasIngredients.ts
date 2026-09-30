import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";
import { normaliserTexte } from "../utils/normaliserTexte.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";

const router = Router();

// Liste complète des correspondances mémorisées (texte d'ingrédient -> article), utilisée côté
// client pour pré-remplir automatiquement l'import d'une recette (voir ImporterRecetteModal.tsx).
// Table de taille modeste par nature (un alias par formulation d'ingrédient déjà rencontrée) :
// pas besoin de pagination.
router.get("/", async (req: Request, res: Response) => {
  try {
    // AliasIngredientImport n'a pas de societeId propre (texteNormalise est une clé globale, voir
    // prisma/schema.prisma) : scopé transitivement par l'article visé, pour ne jamais suggérer à
    // une société l'articleId d'une autre société (voir la matrice de permissions, server/app.ts).
    const alias = await prisma.aliasIngredientImport.findMany({
      where: { article: { societeId: req.utilisateur!.societeId } },
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

    const candidates = (correspondances ?? []).filter((c) => c.texte?.trim() && c.articleId);

    // texteNormalise est une clé globale (voir GET ci-dessus) : jamais rediriger cet alias partagé
    // vers l'articleId d'une AUTRE société en devinant/énumérant simplement un id — silencieusement
    // ignoré, même principe permissif que pour un articleId désactivé entretemps (voir commentaire
    // au-dessus de cette route).
    const articlesDeLaSociete = await prisma.article.findMany({
      where: {
        id: { in: [...new Set(candidates.map((c) => c.articleId))] },
        societeId: req.utilisateur!.societeId,
      },
      select: { id: true },
    });
    const idsAutorises = new Set(articlesDeLaSociete.map((a) => a.id));
    const aTraiter = candidates.filter((c) => idsAutorises.has(c.articleId));

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
    repondreErreurEcriture(error, res, "Impossible d'enregistrer les correspondances d'ingrédients");
  }
});

export default router;
