import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

const schemaEcriture = z.object({ nom: z.string().trim().min(1) });

// Liste des catégories
router.get("/", async (req: Request, res: Response) => {
  const categories = await prisma.categorie.findMany({
    where: { societeId: req.utilisateur!.societeId },
    orderBy: {
      nom: "asc",
    },
  });

  res.json(categories);
});

// Création d'une catégorie
router.post("/", async (req: Request, res: Response) => {
  const parsed = schemaEcriture.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Catégorie invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const { nom } = parsed.data;
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir F02 de l'audit forensique).
    const societeId = req.utilisateur!.societeId;

    const categorie = await prisma.categorie.create({
      data: {
        nom,
        societeId,
      },
    });

    res.status(201).json(categorie);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de créer la catégorie", req);
  }
});

// Renommage d'une catégorie
router.put("/:id", async (req: Request, res: Response) => {
  const parsed = schemaEcriture.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Catégorie invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const id = Number(req.params.id);
    const { nom } = parsed.data;

    // Scopé par société : jamais permettre à un compte de modifier une catégorie d'une autre
    // société en devinant/énumérant simplement un id (voir F11 de l'audit forensique).
    const existante = await prisma.categorie.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!existante) {
      res.status(404).json({ error: "Catégorie introuvable" });
      return;
    }

    const categorie = await prisma.categorie.update({ where: { id }, data: { nom } });

    res.json(categorie);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de modifier la catégorie", req);
  }
});

// Suppression d'une catégorie : refusée si des articles l'utilisent encore
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    // Scopé par société : jamais permettre à un compte de supprimer une catégorie d'une autre
    // société en devinant/énumérant simplement un id (voir F11 de l'audit forensique).
    const existante = await prisma.categorie.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!existante) {
      res.status(404).json({ error: "Catégorie introuvable" });
      return;
    }

    const nbArticles = await prisma.article.count({ where: { categorieId: id } });

    if (nbArticles > 0) {
      res.status(400).json({
        error: "Cette catégorie est utilisée par des ingrédients et ne peut pas être supprimée.",
      });
      return;
    }

    await prisma.categorie.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer la catégorie" });
  }
});

export default router;
