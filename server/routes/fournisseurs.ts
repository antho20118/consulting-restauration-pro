import { Router } from "express";

import prisma from "../prisma.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";

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

// Fiche fournisseur (voir chantier listings/factures — Phase 5) : uniquement l'identifiant du
// fournisseur en paramètre, jamais un chemin arbitraire. Un 404 explicite distingue "fournisseur
// inexistant" d'une erreur serveur — le frontend ne doit jamais confondre les deux.
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Identifiant fournisseur invalide" });
      return;
    }

    const fournisseur = await prisma.fournisseur.findUnique({ where: { id } });
    if (!fournisseur) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }

    res.json(fournisseur);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer ce fournisseur" });
  }
});

// Onglet "Articles / Tarifs" de la fiche fournisseur : tarifs actifs ET historiques (dateFin non
// nul inclus) — un tarif clôturé n'est jamais masqué, voir cadrage §7. La traçabilité vers le
// document source n'est incluse que lorsqu'elle existe réellement (voir ligneDocumentSource,
// Phase 2) : un tarif créé avant ce chantier ou manuellement n'a jamais de source inventée.
router.get("/:id/tarifs", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Identifiant fournisseur invalide" });
      return;
    }

    const fournisseur = await prisma.fournisseur.findUnique({ where: { id } });
    if (!fournisseur) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }

    const tarifs = await prisma.tarifArticle.findMany({
      where: { fournisseurId: id },
      include: {
        article: { select: { id: true, nom: true, reference: true } },
        unite: { select: { symbole: true } },
        conditionnement: { select: { nom: true } },
        ligneDocumentSource: {
          select: {
            id: true,
            designationLue: true,
            document: { select: { id: true, type: true, cle: true, importeLe: true, nomFichierOriginal: true } },
          },
        },
      },
      orderBy: [{ article: { nom: "asc" } }, { dateDebut: "desc" }],
    });

    res.json(tarifs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les tarifs de ce fournisseur" });
  }
});

// Onglet "Listings" de la fiche fournisseur : documents importés (métadonnées seules — jamais le
// contenu du fichier, jamais un chemin, voir storageDocumentsFournisseur.ts). Les lignes détaillées
// d'un document précis sont chargées séparément (voir GET /listings-fournisseur/documents/:id),
// pour ne pas alourdir cette liste si un fournisseur a beaucoup de documents.
router.get("/:id/documents", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Identifiant fournisseur invalide" });
      return;
    }

    const fournisseur = await prisma.fournisseur.findUnique({ where: { id } });
    if (!fournisseur) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }

    const documents = await prisma.documentFournisseur.findMany({
      where: { fournisseurId: id },
      include: { _count: { select: { lignes: true } } },
      orderBy: { importeLe: "desc" },
    });

    res.json(documents);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les documents de ce fournisseur" });
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
    repondreErreurEcriture(error, res, "Impossible de créer le fournisseur");
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
