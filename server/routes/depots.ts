import { Router } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// Bornes du type INT4 de Postgres (colonne `id`), même valeurs que articles.ts et menus.ts : un id
// d'URL non entier ou hors bornes atteignait jusqu'ici Prisma et ressortait en 500.
const ID_POSTGRES_MIN = -2147483648;
const ID_POSTGRES_MAX = 2147483647;

// Contrôle de type uniquement, aucune règle métier (pas de trim/min/max) : le traitement existant
// `description || null` est conservé tel quel ci-dessous.
const schemaCreationDepot = z.object({
  nom: z.string(),
  description: z.string().nullable().optional(),
});
// nom omis en PUT : clé absente, Prisma n'y touche pas (nom conservé).
const schemaModificationDepot = schemaCreationDepot.partial({ nom: true });

function idDepotValide(id: number): boolean {
  return Number.isInteger(id) && id >= ID_POSTGRES_MIN && id <= ID_POSTGRES_MAX;
}

router.get("/", async (req, res) => {
  try {
    const depots = await prisma.depot.findMany({
      where: { actif: true, societeId: req.utilisateur!.societeId },
      orderBy: { nom: "asc" },
    });

    res.json(depots);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer les dépôts" });
  }
});

router.post("/", async (req, res) => {
  try {
    const analyse = schemaCreationDepot.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Dépôt invalide", details: analyse.error.flatten() });
      return;
    }
    const { nom, description } = analyse.data;
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma).
    const societeId = req.utilisateur!.societeId;

    const depot = await prisma.depot.create({
      data: { nom, description: description || null, societeId },
    });

    res.status(201).json(depot);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de créer le dépôt", req);
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!idDepotValide(id)) {
      res.status(400).json({ error: "Identifiant de dépôt invalide" });
      return;
    }

    const analyse = schemaModificationDepot.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Dépôt invalide", details: analyse.error.flatten() });
      return;
    }
    const { nom, description } = analyse.data;

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
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de modifier le dépôt" });
  }
});

// Suppression douce : le dépôt reste référencé par l'historique des stocks et des mouvements
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!idDepotValide(id)) {
      res.status(400).json({ error: "Identifiant de dépôt invalide" });
      return;
    }

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
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer le dépôt" });
  }
});

export default router;
