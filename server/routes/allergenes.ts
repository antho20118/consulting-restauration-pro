import { Router } from "express";

import prisma from "../prisma.js";

const router = Router();

// Liste des 14 allergènes réglementaires (référentiel fixe, pas de CRUD : voir prisma/seed.ts)
router.get("/", async (_req, res) => {
  const allergenes = await prisma.allergene.findMany({ orderBy: { nom: "asc" } });

  res.json(allergenes);
});

export default router;
