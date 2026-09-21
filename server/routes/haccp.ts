import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma.js";
import { evaluerEtapesHACCP, reglesHACCP } from "../utils/haccp.js";

const router = Router();
const idSchema = z.coerce.number().int().positive();

router.get("/regles", (_req, res) => {
  res.json(reglesHACCP);
});

router.get("/evaluer/:id", async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Identifiant invalide" }); return; }
  try {
    const recette = await prisma.recette.findUnique({ where: { id: id.data }, include: { etapes: { orderBy: { ordre: "asc" } } } });
    if (!recette) { res.status(404).json({ error: "Recette introuvable" }); return; }
    res.json({ recetteId: recette.id, recetteNom: recette.nom, etapes: evaluerEtapesHACCP(recette.etapes) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible d'évaluer le HACCP" });
  }
});

export default router;
