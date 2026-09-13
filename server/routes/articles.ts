import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";

const router = Router();

const inclusionsArticle = {
  categorie: true,
  tva: true,
  nutrition: true,
  documents: true,
  allergenes: {
    include: {
      allergene: true,
    },
  },
  tarifs: {
    where: { actif: true },
    orderBy: { dateDebut: "desc" as const },
    take: 1,
    include: {
      fournisseur: true,
      unite: true,
      conditionnement: true,
    },
  },
  stocks: {
    include: {
      depot: true,
    },
  },
};

router.get("/", async (_req: Request, res: Response) => {
  try {
    const articles = await prisma.article.findMany({
      where: { actif: true },
      include: inclusionsArticle,
      orderBy: {
        nom: "asc",
      },
    });

    res.json(articles);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Impossible de récupérer les articles",
    });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      nom,
      reference,
      categorieId,
      tvaId,
      societeId,
      rendement,
      type,
      uniteId,
      fournisseurNom,
      prixHT,
      stockInitial,
      allergeneIds,
    } = req.body;

    const article = await prisma.$transaction(async (tx) => {
      const created = await tx.article.create({
        data: {
          nom,
          reference,
          categorieId,
          tvaId,
          societeId,
          rendement,
          type,
        },
      });

      if (Array.isArray(allergeneIds) && allergeneIds.length > 0) {
        await tx.articleAllergene.createMany({
          data: allergeneIds.map((allergeneId: number) => ({
            articleId: created.id,
            allergeneId,
          })),
        });
      }

      // Tarif (prix + unité + fournisseur) : uniquement si une unité et un prix ont été fournis
      if (uniteId && prixHT !== undefined && prixHT !== null) {
        const fournisseurId = await trouverOuCreerFournisseur(tx, fournisseurNom, societeId);

        // Conditionnement par défaut : le premier existant (non exposé dans ce formulaire simplifié)
        const conditionnement = await tx.conditionnement.findFirst({ orderBy: { id: "asc" } });
        if (conditionnement) {
          await tx.tarifArticle.create({
            data: {
              articleId: created.id,
              fournisseurId,
              uniteId,
              conditionnementId: conditionnement.id,
              quantiteConditionnement: 1,
              prixHT,
            },
          });
        }
      }

      // Stock initial : uniquement si un dépôt existe déjà pour cette société
      if (stockInitial !== undefined && stockInitial !== null) {
        const depot = await tx.depot.findFirst({ where: { societeId } });
        if (depot) {
          await tx.stock.create({
            data: { articleId: created.id, depotId: depot.id, quantite: stockInitial },
          });
        }
      }

      return tx.article.findUnique({
        where: { id: created.id },
        include: inclusionsArticle,
      });
    });

    res.status(201).json(article);
  } catch (error) {
    console.error("========== ERREUR PRISMA ==========");
    console.error(error);
    console.error("===================================");

    res.status(500).json(error);
  }
});

// Modification d'un article : les champs de base sont mis à jour directement ; un changement
// de prix/unité/fournisseur clôt le tarif actif et en ouvre un nouveau (historique des prix) ;
// le stock du dépôt principal est ajusté à la valeur saisie.
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const {
      nom,
      reference,
      categorieId,
      rendement,
      uniteId,
      fournisseurNom,
      prixHT,
      stockInitial,
      allergeneIds,
    } = req.body;

    const article = await prisma.$transaction(async (tx) => {
      const existant = await tx.article.findUniqueOrThrow({ where: { id } });

      await tx.article.update({
        where: { id },
        data: { nom, reference, categorieId, rendement },
      });

      if (Array.isArray(allergeneIds)) {
        await tx.articleAllergene.deleteMany({ where: { articleId: id } });

        if (allergeneIds.length > 0) {
          await tx.articleAllergene.createMany({
            data: allergeneIds.map((allergeneId: number) => ({ articleId: id, allergeneId })),
          });
        }
      }

      if (uniteId && prixHT !== undefined && prixHT !== null) {
        const fournisseurId = await trouverOuCreerFournisseur(tx, fournisseurNom, existant.societeId);

        const tarifActif = await tx.tarifArticle.findFirst({
          where: { articleId: id, actif: true },
          orderBy: { dateDebut: "desc" },
        });

        const inchange =
          tarifActif &&
          tarifActif.uniteId === uniteId &&
          tarifActif.fournisseurId === fournisseurId &&
          tarifActif.prixHT === prixHT;

        if (!inchange) {
          if (tarifActif) {
            await tx.tarifArticle.update({
              where: { id: tarifActif.id },
              data: { actif: false, dateFin: new Date() },
            });
          }

          const conditionnement = await tx.conditionnement.findFirst({ orderBy: { id: "asc" } });
          if (conditionnement) {
            await tx.tarifArticle.create({
              data: {
                articleId: id,
                fournisseurId,
                uniteId,
                conditionnementId: conditionnement.id,
                quantiteConditionnement: 1,
                prixHT,
              },
            });
          }
        }
      }

      if (stockInitial !== undefined && stockInitial !== null) {
        const depot = await tx.depot.findFirst({ where: { societeId: existant.societeId } });
        if (depot) {
          await tx.stock.upsert({
            where: { articleId_depotId: { articleId: id, depotId: depot.id } },
            update: { quantite: stockInitial },
            create: { articleId: id, depotId: depot.id, quantite: stockInitial },
          });
        }
      }

      return tx.article.findUnique({ where: { id }, include: inclusionsArticle });
    });

    res.json(article);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier l'article" });
  }
});

// Suppression (douce) d'un article
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    await prisma.article.update({ where: { id }, data: { actif: false } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer l'article" });
  }
});

async function trouverOuCreerFournisseur(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  fournisseurNom: string | undefined,
  societeId: number
): Promise<number> {
  const nomFournisseur = (fournisseurNom || "").trim();
  const nomRecherche = nomFournisseur || "Non renseigné";

  const existant = await tx.fournisseur.findFirst({ where: { nom: nomRecherche, societeId } });
  if (existant) return existant.id;

  const cree = await tx.fournisseur.create({ data: { nom: nomRecherche, societeId } });
  return cree.id;
}

export default router;
