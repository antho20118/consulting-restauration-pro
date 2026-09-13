import { Router } from "express";

import prisma from "../prisma.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const fournisseurs = await prisma.fournisseur.findMany({
      where: { actif: true },
      include: { _count: { select: { tarifs: true } } },
      orderBy: { nom: "asc" },
    });

    res.json(fournisseurs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les fournisseurs" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { nom, telephone, email, siteWeb, societeId } = req.body;

    const fournisseur = await prisma.fournisseur.create({
      data: {
        nom,
        telephone: telephone || null,
        email: email || null,
        siteWeb: siteWeb || null,
        societeId,
      },
    });

    res.status(201).json(fournisseur);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de créer le fournisseur" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nom, telephone, email, siteWeb } = req.body;

    const fournisseur = await prisma.fournisseur.update({
      where: { id },
      data: {
        nom,
        telephone: telephone || null,
        email: email || null,
        siteWeb: siteWeb || null,
      },
    });

    res.json(fournisseur);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier le fournisseur" });
  }
});

// Suppression douce : un fournisseur peut rester référencé par l'historique des tarifs
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    await prisma.fournisseur.update({ where: { id }, data: { actif: false } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer le fournisseur" });
  }
});

export default router;
