import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// `parentId` reste optionnel (absent ≡ null) : certains appelants existants (voir
// isolationReferentielsCategorie.test.ts) n'envoient que `nom` sur un PUT de renommage pur, sans
// jamais vouloir toucher au parent.
const schemaEcriture = z.object({
  nom: z.string().trim().min(1),
  parentId: z.number().int().positive().nullable().optional(),
});

// Hiérarchie à un seul niveau par conception (voir prisma/schema.prisma sur SousCategorieRecette,
// et SousCategoriesRecetteManager.tsx qui ne propose déjà que des racines comme parent) : un parent
// qui a lui-même un parent ne doit jamais être accepté, sous peine de créer une chaîne à plusieurs
// niveaux que ni le schéma ni l'interface ne prévoient.
const MESSAGE_PARENT_INVALIDE = "Sous-catégorie parente invalide";

// Liste des sous-catégories de recettes (type d'ingrédient principal)
router.get("/", async (req: Request, res: Response) => {
  const sousCategories = await prisma.sousCategorieRecette.findMany({
    where: { societeId: req.utilisateur!.societeId },
    orderBy: {
      nom: "asc",
    },
  });

  res.json(sousCategories);
});

// Création d'une sous-catégorie de recette
router.post("/", async (req: Request, res: Response) => {
  const parsed = schemaEcriture.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Sous-catégorie de recette invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const { nom, parentId } = parsed.data;
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir F02 de l'audit forensique).
    const societeId = req.utilisateur!.societeId;

    if (parentId != null) {
      // Un parent ne peut être choisi que parmi les sous-catégories de la même société (voir F11
      // de l'audit forensique) : sans ce contrôle, un id d'une autre société serait accepté tel quel.
      const parent = await prisma.sousCategorieRecette.findFirst({ where: { id: parentId, societeId } });
      if (!parent || parent.parentId !== null) {
        res.status(400).json({ error: MESSAGE_PARENT_INVALIDE });
        return;
      }
    }

    const sousCategorie = await prisma.sousCategorieRecette.create({
      data: {
        nom,
        parentId: parentId ?? null,
        societeId,
      },
    });

    res.status(201).json(sousCategorie);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de créer la sous-catégorie de recette", req);
  }
});

// Renommage d'une sous-catégorie de recette
router.put("/:id", async (req: Request, res: Response) => {
  const parsed = schemaEcriture.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Sous-catégorie de recette invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const id = Number(req.params.id);
    const { nom, parentId } = parsed.data;
    const societeId = req.utilisateur!.societeId;

    // Jamais devenir son propre parent (voir F09/F10 de l'audit : auto-référence non gardée).
    if (parentId === id) {
      res.status(400).json({ error: MESSAGE_PARENT_INVALIDE });
      return;
    }

    if (parentId != null) {
      const parent = await prisma.sousCategorieRecette.findFirst({ where: { id: parentId, societeId } });
      if (!parent || parent.parentId !== null) {
        res.status(400).json({ error: MESSAGE_PARENT_INVALIDE });
        return;
      }

      // Vérifier que le parent choisi est une racine ne suffit pas : si la sous-catégorie modifiée
      // a elle-même déjà des enfants, la rattacher à ce parent produirait quand même une chaîne à
      // 3 niveaux (parent → elle → ses enfants), contraire à la hiérarchie à un seul niveau.
      const nbEnfants = await prisma.sousCategorieRecette.count({ where: { parentId: id } });
      if (nbEnfants > 0) {
        res.status(400).json({ error: MESSAGE_PARENT_INVALIDE });
        return;
      }
    }

    // Scopé par société : jamais permettre à un compte de modifier une sous-catégorie d'une autre
    // société en devinant/énumérant simplement un id (voir F11 de l'audit forensique).
    const sousCategorie = await prisma.$transaction(async (tx) => {
      await tx.sousCategorieRecette.findFirstOrThrow({ where: { id, societeId } });

      return tx.sousCategorieRecette.update({
        where: { id },
        data: { nom, parentId: parentId ?? null },
      });
    });

    res.json(sousCategorie);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de modifier la sous-catégorie de recette", req);
  }
});

// Suppression d'une sous-catégorie de recette : refusée si des recettes l'utilisent encore
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    // Scopé par société : jamais permettre à un compte de supprimer une sous-catégorie d'une
    // autre société en devinant/énumérant simplement un id (voir F11 de l'audit forensique).
    const existante = await prisma.sousCategorieRecette.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!existante) {
      res.status(404).json({ error: "Sous-catégorie de recette introuvable" });
      return;
    }

    const nbRecettes = await prisma.recette.count({ where: { sousCategorieId: id } });

    if (nbRecettes > 0) {
      res.status(400).json({
        error: "Cette sous-catégorie est utilisée par des recettes et ne peut pas être supprimée.",
      });
      return;
    }

    await prisma.sousCategorieRecette.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer la sous-catégorie de recette" });
  }
});

export default router;
