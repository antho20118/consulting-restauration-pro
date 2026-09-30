import { Router } from "express";

import prisma from "../prisma.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const depots = await prisma.depot.findMany({
      where: { actif: true, societeId: req.utilisateur!.societeId },
      orderBy: { nom: "asc" },
    });

    res.json(depots);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les dépôts" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { nom, description } = req.body;
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma).
    const societeId = req.utilisateur!.societeId;

    const depot = await prisma.depot.create({
      data: { nom, description: description || null, societeId },
    });

    res.status(201).json(depot);
  } catch (error) {
    repondreErreurEcriture(error, res, "Impossible de créer le dépôt");
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nom, description } = req.body;

    // Scopé par société : jamais permettre à un compte de modifier un dépôt d'une autre société en
    // devinant/énumérant simplement un id (voir la matrice de permissions, server/app.ts).
    const existant = await prisma.depot.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!existant) {
      res.status(404).json({ error: "Dépôt introuvable" });
      return;
    }

    const depot = await prisma.depot.update({
      where: { id },
      data: { nom, description: description || null },
    });

    res.json(depot);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier le dépôt" });
  }
});

// Suppression douce : le dépôt reste référencé par l'historique des stocks et des mouvements
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const { count } = await prisma.depot.updateMany({
      where: { id, societeId: req.utilisateur!.societeId },
      data: { actif: false },
    });
    if (count === 0) {
      res.status(404).json({ error: "Dépôt introuvable" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer le dépôt" });
  }
});

export default router;
