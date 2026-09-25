import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";
import { calculerCoutMenu, calculerCoutsMenusSansErreur, inclusionsMenu } from "../utils/coutMenu.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";

const router = Router();

// Liste des menus
router.get("/", async (_req: Request, res: Response) => {
  try {
    const menus = await prisma.menu.findMany({
      where: { actif: true },
      include: inclusionsMenu,
      orderBy: { nom: "asc" },
    });

    res.json(calculerCoutsMenusSansErreur(menus));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les menus" });
  }
});

// Détail d'un menu
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const menu = await prisma.menu.findUnique({
      where: { id },
      include: inclusionsMenu,
    });

    if (!menu) {
      res.status(404).json({ error: "Menu introuvable" });
      return;
    }

    res.json(calculerCoutMenu(menu));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer le menu" });
  }
});

// Création d'un menu
router.post("/", async (req: Request, res: Response) => {
  try {
    const { nom, description, categorieId, societeId, prixVenteHT, lignes } = req.body as {
      nom: string;
      description?: string | null;
      categorieId?: number | null;
      societeId: number;
      prixVenteHT?: number | null;
      lignes: { recetteId: number; quantite: number }[];
    };

    const menu = await prisma.menu.create({
      data: {
        nom,
        description: description ?? null,
        categorieId: categorieId ?? null,
        societeId,
        prixVenteHT: prixVenteHT ?? null,
        lignes: {
          create: (lignes ?? []).map((ligne, index) => ({
            recetteId: ligne.recetteId,
            quantite: ligne.quantite,
            ordre: index,
          })),
        },
      },
      include: inclusionsMenu,
    });

    res.status(201).json(calculerCoutMenu(menu));
  } catch (error) {
    repondreErreurEcriture(error, res, "Impossible de créer le menu");
  }
});

// Mise à jour d'un menu (les lignes sont remplacées intégralement)
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const { nom, description, categorieId, prixVenteHT, lignes } = req.body as {
      nom: string;
      description?: string | null;
      categorieId?: number | null;
      prixVenteHT?: number | null;
      lignes: { recetteId: number; quantite: number }[];
    };

    const menu = await prisma.$transaction(async (tx) => {
      await tx.menuLigne.deleteMany({ where: { menuId: id } });

      return tx.menu.update({
        where: { id },
        data: {
          nom,
          description: description ?? null,
          categorieId: categorieId ?? null,
          prixVenteHT: prixVenteHT ?? null,
          lignes: {
            create: (lignes ?? []).map((ligne, index) => ({
              recetteId: ligne.recetteId,
              quantite: ligne.quantite,
              ordre: index,
            })),
          },
        },
        include: inclusionsMenu,
      });
    });

    res.json(calculerCoutMenu(menu));
  } catch (error) {
    repondreErreurEcriture(error, res, "Impossible de mettre à jour le menu");
  }
});

// Suppression (douce) d'un menu
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    await prisma.menu.update({ where: { id }, data: { actif: false } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer le menu" });
  }
});

export default router;
