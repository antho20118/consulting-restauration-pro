import { Router } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// Référentiel partagé entre toutes les sociétés (voir autoriserEcritureSuperAdmin.ts) : taux
// intervient directement dans les calculs de prix de toutes les sociétés — une valeur hors de la
// plage possible d'un taux de TVA (0 à 100) les corromprait silencieusement. `.strict()` : aucun
// contrat existant ne repose sur une clé supplémentaire tolérée (aucun appelant frontend actuel),
// donc la refuser explicitement plutôt que la tronquer silencieusement.
const schemaCreation = z
  .object({
    nom: z.string().trim().min(1),
    taux: z.number().finite().min(0).max(100),
  })
  .strict();

// PUT ne doit pas exiger les 2 champs : avant toute validation, un champ absent devenait `undefined`
// après déstructuration et Prisma l'ignore (ne le modifie pas) — un PUT partiel (ex. ne changer que
// taux) fonctionnait donc de fait. schemaCreation.partial() préserve ce contrat réel plutôt que de
// le casser ; le refine ci-dessous empêche seulement un corps sans aucun champ reconnu.
const schemaModification = schemaCreation.partial().refine((donnees) => Object.keys(donnees).length > 0, {
  message: "Au moins un champ (nom, taux) doit être fourni",
});

// Liste des taux de TVA
router.get("/", async (_req, res) => {
  const tvas = await prisma.tVA.findMany({
    where: { actif: true },
    orderBy: { taux: "asc" },
  });

  res.json(tvas);
});

// Création d'un taux de TVA
router.post("/", async (req, res) => {
  const parsed = schemaCreation.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Taux de TVA invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const { nom, taux } = parsed.data;

    const tva = await prisma.tVA.create({ data: { nom, taux } });

    res.status(201).json(tva);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de créer la TVA" });
  }
});

// Modification d'un taux de TVA
router.put("/:id", async (req, res) => {
  const parsed = schemaModification.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Taux de TVA invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const id = Number(req.params.id);
    const { nom, taux } = parsed.data;

    const tva = await prisma.tVA.update({ where: { id }, data: { nom, taux } });

    res.json(tva);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de modifier la TVA" });
  }
});

// Suppression d'un taux de TVA : refusée si des articles l'utilisent encore
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const nbArticles = await prisma.article.count({ where: { tvaId: id } });

    if (nbArticles > 0) {
      res.status(400).json({
        error: "Ce taux de TVA est utilisé par des ingrédients et ne peut pas être supprimé.",
      });
      return;
    }

    await prisma.tVA.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer la TVA" });
  }
});

export default router;
