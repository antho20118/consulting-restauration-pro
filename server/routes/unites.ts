import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

// Liste des unités
router.get("/", async (_req, res) => {
  const unites = await prisma.unite.findMany({
    where: { actif: true },
    orderBy: { nom: "asc" },
  });

  res.json(unites);
});

export default router;
