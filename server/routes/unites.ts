import { Router } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";
import { LIBELLE_UNITE_BASE } from "../utils/uniteConversion.js";

const router = Router();

// Référentiel partagé entre toutes les sociétés (voir autoriserEcritureSuperAdmin.ts) : facteurBase
// intervient directement dans tous les calculs de coût/prix (versUniteBase, coutRecette.ts) pour
// toutes les sociétés — une valeur aberrante acceptée ici les corromprait silencieusement bien
// après l'écriture elle-même. `type` reprend l'énumération déjà en vigueur dans uniteConversion.ts
// (LIBELLE_UNITE_BASE) plutôt que d'en dupliquer la liste. `.strict()` : aucun contrat existant ne
// repose sur une clé supplémentaire tolérée (aucun appelant frontend actuel), donc la refuser
// explicitement plutôt que la tronquer silencieusement.
const schemaCreation = z
  .object({
    nom: z.string().trim().min(1),
    symbole: z.string().trim().min(1),
    type: z.enum(Object.keys(LIBELLE_UNITE_BASE) as [string, ...string[]]),
    facteurBase: z.number().finite().positive(),
  })
  .strict();

// PUT ne doit pas exiger les 4 champs : avant toute validation, un champ absent devenait `undefined`
// après déstructuration et Prisma l'ignore (ne le modifie pas) — un PUT partiel (ex. ne changer que
// facteurBase) fonctionnait donc de fait. schemaCreation.partial() préserve ce contrat réel plutôt
// que de le casser ; le refine ci-dessous empêche seulement un corps sans aucun champ reconnu.
const schemaModification = schemaCreation.partial().refine((donnees) => Object.keys(donnees).length > 0, {
  message: "Au moins un champ (nom, symbole, type, facteurBase) doit être fourni",
});

// Liste des unités
router.get("/", async (_req, res) => {
  const unites = await prisma.unite.findMany({
    where: { actif: true },
    orderBy: { nom: "asc" },
  });

  res.json(unites);
});

// Création d'une unité
router.post("/", async (req, res) => {
  const parsed = schemaCreation.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Unité invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const { nom, symbole, type, facteurBase } = parsed.data;

    const unite = await prisma.unite.create({ data: { nom, symbole, type, facteurBase } });

    res.status(201).json(unite);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de créer l'unité" });
  }
});

// Modification d'une unité
router.put("/:id", async (req, res) => {
  const parsed = schemaModification.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Unité invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const id = Number(req.params.id);
    const { nom, symbole, type, facteurBase } = parsed.data;

    const unite = await prisma.unite.update({
      where: { id },
      data: { nom, symbole, type, facteurBase },
    });

    res.json(unite);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de modifier l'unité" });
  }
});

// Suppression d'une unité : refusée si des tarifs ou des lignes de recette l'utilisent encore
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [nbTarifs, nbLignes] = await Promise.all([
      prisma.tarifArticle.count({ where: { uniteId: id } }),
      prisma.recetteLigne.count({ where: { uniteId: id } }),
    ]);

    if (nbTarifs > 0 || nbLignes > 0) {
      res.status(400).json({
        error:
          "Cette unité est utilisée par des tarifs ou des lignes de recette et ne peut pas être supprimée.",
      });
      return;
    }

    await prisma.unite.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer l'unité" });
  }
});

export default router;
