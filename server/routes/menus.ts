import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";
import { calculerCoutMenu, calculerCoutsMenusSansErreur, inclusionsMenu } from "../utils/coutMenu.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// Cloisonnement multi-société (faille confirmée : un recetteId d'une autre société pouvait être
// injecté dans un menu sans aucune vérification, contrairement à categorieId juste au-dessus dans
// les mêmes handlers — GET /:id réexposait ensuite nom/coût/allergènes/nutrition de la recette
// étrangère via inclusionsMenu). Vérification groupée (une seule requête, jamais une par ligne) ;
// ne distingue jamais "recetteId inexistant" de "recetteId d'une autre société" dans la réponse.
async function recettesAppartiennentALaSociete(recetteIds: number[], societeId: number): Promise<boolean> {
  if (recetteIds.length === 0) return true;
  const recettesValides = await prisma.recette.findMany({
    where: { id: { in: recetteIds }, societeId },
    select: { id: true },
  });
  return recettesValides.length === recetteIds.length;
}

// Liste des menus
router.get("/", async (req: Request, res: Response) => {
  try {
    const menus = await prisma.menu.findMany({
      where: { actif: true, societeId: req.utilisateur!.societeId },
      include: inclusionsMenu,
      orderBy: { nom: "asc" },
    });

    res.json(calculerCoutsMenusSansErreur(menus));
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer les menus" });
  }
});

// Détail d'un menu
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    // Scopé par société : jamais permettre de deviner/énumérer un menu d'une autre société en
    // devinant simplement un id (voir la matrice de permissions, server/app.ts).
    const menu = await prisma.menu.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
      include: inclusionsMenu,
    });

    if (!menu) {
      res.status(404).json({ error: "Menu introuvable" });
      return;
    }

    res.json(calculerCoutMenu(menu));
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer le menu" });
  }
});

// Création d'un menu
router.post("/", async (req: Request, res: Response) => {
  try {
    const { nom, description, categorieId, prixVenteHT, lignes } = req.body as {
      nom: string;
      description?: string | null;
      categorieId?: number | null;
      prixVenteHT?: number | null;
      lignes: { recetteId: number; quantite: number }[];
    };
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma).
    const societeId = req.utilisateur!.societeId;

    // CategorieRecette est désormais cloisonnée par société (voir F11 de l'audit forensique) :
    // jamais accepter un categorieId d'une autre société en devinant/énumérant simplement un id.
    if (categorieId != null) {
      const categorieValide = await prisma.categorieRecette.findFirst({ where: { id: categorieId, societeId } });
      if (!categorieValide) {
        res.status(400).json({ error: "Catégorie invalide" });
        return;
      }
    }

    // Jamais accepter un recetteId d'une autre société en devinant/énumérant simplement un id
    // (même principe que categorieId ci-dessus) — voir le commentaire de
    // recettesAppartiennentALaSociete en tête de fichier.
    const recetteIds = [...new Set((lignes ?? []).map((ligne) => ligne.recetteId))];
    if (!(await recettesAppartiennentALaSociete(recetteIds, societeId))) {
      res.status(400).json({ error: "Une ou plusieurs recettes sont invalides" });
      return;
    }

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
    await repondreErreurEcriture(error, res, "Impossible de créer le menu", req);
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

    // CategorieRecette est désormais cloisonnée par société (voir F11 de l'audit forensique) :
    // jamais accepter un categorieId d'une autre société en devinant/énumérant simplement un id.
    if (categorieId != null) {
      const categorieValide = await prisma.categorieRecette.findFirst({
        where: { id: categorieId, societeId: req.utilisateur!.societeId },
      });
      if (!categorieValide) {
        res.status(400).json({ error: "Catégorie invalide" });
        return;
      }
    }

    // Même garde-fou qu'à la création (voir POST / ci-dessus) : vérifié AVANT le $transaction, donc
    // avant tout deleteMany/update — un payload contenant une recette étrangère laisse le menu
    // existant strictement inchangé.
    const recetteIds = [...new Set((lignes ?? []).map((ligne) => ligne.recetteId))];
    if (!(await recettesAppartiennentALaSociete(recetteIds, req.utilisateur!.societeId))) {
      res.status(400).json({ error: "Une ou plusieurs recettes sont invalides" });
      return;
    }

    const menu = await prisma.$transaction(async (tx) => {
      // Scopé par société : jamais permettre à un compte de modifier un menu d'une autre société
      // en devinant/énumérant simplement un id (voir la matrice de permissions, server/app.ts).
      await tx.menu.findFirstOrThrow({ where: { id, societeId: req.utilisateur!.societeId } });

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
    await repondreErreurEcriture(error, res, "Impossible de mettre à jour le menu", req);
  }
});

// Suppression (douce) d'un menu
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const { count } = await prisma.menu.updateMany({
      where: { id, societeId: req.utilisateur!.societeId },
      data: { actif: false },
    });
    if (count === 0) {
      res.status(404).json({ error: "Menu introuvable" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer le menu" });
  }
});

export default router;
