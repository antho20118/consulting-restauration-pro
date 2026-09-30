import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import prisma from "../prisma.js";
import { evaluerEtapesHACCP, reglesHACCP } from "../utils/haccp.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();
const idSchema = z.coerce.number().int().positive();

router.get("/regles", (_req, res) => {
  res.json(reglesHACCP);
});

router.get("/evaluer/:id", async (req: Request, res: Response) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Identifiant invalide" }); return; }
  try {
    // Scopé par société : jamais permettre d'évaluer le HACCP d'une recette d'une autre société en
    // devinant/énumérant simplement un id (voir la matrice de permissions, server/app.ts).
    const recette = await prisma.recette.findFirst({
      where: { id: id.data, societeId: req.utilisateur!.societeId },
      include: { etapes: { orderBy: { ordre: "asc" } } },
    });
    if (!recette) { res.status(404).json({ error: "Recette introuvable" }); return; }
    res.json({ recetteId: recette.id, recetteNom: recette.nom, etapes: evaluerEtapesHACCP(recette.etapes) });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'évaluer le HACCP" });
  }
});

export default router;
