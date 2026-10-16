import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { normaliserTexte } from "../utils/normaliserTexte.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";
import { ID_POSTGRES_MIN, ID_POSTGRES_MAX } from "../utils/idUrl.js";

const router = Router();

// Structure seule (F09/F10) : un `correspondances` non tableau, un élément non objet, un texte non
// chaîne ou un articleId non entier/hors bornes INT4 faisaient planter le filtre ou la requête
// Prisma ci-dessous en 500. Le contrat permissif de POST est préservé : `correspondances` absent ou
// null, un texte vide/absent ou un articleId nul/absent restent acceptés puis silencieusement
// ignorés (voir le commentaire de la route).
const schemaCorrespondances = z.object({
  correspondances: z
    .array(
      z.object({
        texte: z.string().nullish(),
        articleId: z.number().int().gte(ID_POSTGRES_MIN).lte(ID_POSTGRES_MAX).nullish(),
      })
    )
    .nullish(),
});

// Liste complète des correspondances mémorisées (texte d'ingrédient -> article), utilisée côté
// client pour pré-remplir automatiquement l'import d'une recette (voir ImporterRecetteModal.tsx).
// Table de taille modeste par nature (un alias par formulation d'ingrédient déjà rencontrée) :
// pas besoin de pagination.
router.get("/", async (req: Request, res: Response) => {
  try {
    // Correspondances propres à la société (clé unique societeId + texteNormalise, voir
    // prisma/schema.prisma) : jamais celles d'une autre société.
    const alias = await prisma.aliasIngredientImport.findMany({
      where: { societeId: req.utilisateur!.societeId },
      select: { texteNormalise: true, articleId: true },
    });

    res.json(alias);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
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
  const analyse = schemaCorrespondances.safeParse(req.body);
  if (!analyse.success) {
    res.status(400).json({ error: "Correspondances invalides", details: analyse.error.flatten() });
    return;
  }

  try {
    const candidates = (analyse.data.correspondances ?? []).flatMap((c) =>
      c.texte?.trim() && c.articleId ? [{ texte: c.texte, articleId: c.articleId }] : []
    );

    // Jamais un alias vers l'articleId d'une AUTRE société (id deviné ou énuméré) — silencieusement
    // ignoré, même principe permissif que pour un articleId désactivé entretemps (voir commentaire
    // au-dessus de cette route).
    const societeId = req.utilisateur!.societeId;
    const articlesDeLaSociete = await prisma.article.findMany({
      where: {
        id: { in: [...new Set(candidates.map((c) => c.articleId))] },
        societeId,
      },
      select: { id: true },
    });
    const idsAutorises = new Set(articlesDeLaSociete.map((a) => a.id));
    const aTraiter = candidates.filter((c) => idsAutorises.has(c.articleId));

    await Promise.all(
      aTraiter.map((c) => {
        const texteNormalise = normaliserTexte(c.texte);
        if (!texteNormalise) return null;

        // Clé (société, texte) : la correspondance d'une autre société pour le même texte reste
        // intacte (point 10 de l'audit du 15/10).
        return prisma.aliasIngredientImport.upsert({
          where: { societeId_texteNormalise: { societeId, texteNormalise } },
          create: { societeId, texteNormalise, articleId: c.articleId },
          update: { articleId: c.articleId },
        });
      })
    );

    res.status(204).send();
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible d'enregistrer les correspondances d'ingrédients", req);
  }
});

export default router;
