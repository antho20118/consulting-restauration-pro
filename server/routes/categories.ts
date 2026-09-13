import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

// Liste des catégories
router.get("/", async (_, res) => {
  const categories = await prisma.categorie.findMany({
    orderBy: {
      nom: "asc",
    },
  });

  res.json(categories);
});

// Création d'une catégorie
router.post("/", async (req, res) => {
  const { nom } = req.body;

  const categorie = await prisma.categorie.create({
    data: {
      nom,
    },
  });

  res.json(categorie);
});

export default router;