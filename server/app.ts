import express from "express";
import cors from "cors";
import type { Request, Response } from "express";

import prisma from "./prisma.js";
import categoriesRouter from "./routes/categories.js";
import unitesRouter from "./routes/unites.js";
import recettesRouter from "./routes/recettes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/categories", categoriesRouter);
app.use("/unites", unitesRouter);
app.use("/recettes", recettesRouter);

app.get("/", (_req, res) => {
  res.json({
    application: "Consulting Restauration Pro",
    version: "1.0.0",
    status: "OK",
  });
});

app.get("/articles", async (_req: Request, res: Response) => {
  try {
    const articles = await prisma.article.findMany({
      include: {
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
      },
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

app.post("/articles", async (req: Request, res: Response) => {
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

      // Tarif (prix + unité + fournisseur) : uniquement si une unité et un prix ont été fournis
      if (uniteId && prixHT !== undefined && prixHT !== null) {
        let fournisseurId: number;
        const nomFournisseur = (fournisseurNom || "").trim();
        if (nomFournisseur) {
          const fournisseurExistant = await tx.fournisseur.findFirst({
            where: { nom: nomFournisseur, societeId },
          });
          fournisseurId = fournisseurExistant
            ? fournisseurExistant.id
            : (await tx.fournisseur.create({ data: { nom: nomFournisseur, societeId } })).id;
        } else {
          // Fournisseur générique si aucun nom n'a été saisi
          const generique = await tx.fournisseur.findFirst({ where: { nom: "Non renseigné", societeId } });
          fournisseurId = generique
            ? generique.id
            : (await tx.fournisseur.create({ data: { nom: "Non renseigné", societeId } })).id;
        }

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
        include: {
          categorie: true,
          tva: true,
          tarifs: { include: { fournisseur: true, unite: true, conditionnement: true } },
          stocks: { include: { depot: true } },
        },
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

export default app;