import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// Liste des catégories de recettes
router.get("/", async (req: Request, res: Response) => {
  const categories = await prisma.categorieRecette.findMany({
    where: { societeId: req.utilisateur!.societeId },
    orderBy: {
      nom: "asc",
    },
  });

  res.json(categories);
});

// Création d'une catégorie de recette
router.post("/", async (req: Request, res: Response) => {
  try {
    const { nom } = req.body;
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir F02 de l'audit forensique).
    const societeId = req.utilisateur!.societeId;

    const categorie = await prisma.categorieRecette.create({
      data: {
        nom,
        societeId,
      },
    });

    res.status(201).json(categorie);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de créer la catégorie de recette" });
  }
});

// Renommage d'une catégorie de recette
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { nom } = req.body;

    // Scopé par société : jamais permettre à un compte de modifier une catégorie d'une autre
    // société en devinant/énumérant simplement un id (voir F11 de l'audit forensique).
    const existante = await prisma.categorieRecette.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!existante) {
      res.status(404).json({ error: "Catégorie de recette introuvable" });
      return;
    }

    const categorie = await prisma.categorieRecette.update({ where: { id }, data: { nom } });

    res.json(categorie);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de modifier la catégorie de recette" });
  }
});

// Suppression d'une catégorie de recette : refusée si des recettes l'utilisent encore
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    // Scopé par société : jamais permettre à un compte de supprimer une catégorie d'une autre
    // société en devinant/énumérant simplement un id (voir F11 de l'audit forensique).
    const existante = await prisma.categorieRecette.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!existante) {
      res.status(404).json({ error: "Catégorie de recette introuvable" });
      return;
    }

    const nbRecettes = await prisma.recette.count({ where: { categorieId: id } });

    if (nbRecettes > 0) {
      res.status(400).json({
        error: "Cette catégorie est utilisée par des recettes et ne peut pas être supprimée.",
      });
      return;
    }

    await prisma.categorieRecette.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer la catégorie de recette" });
  }
});

export default router;
