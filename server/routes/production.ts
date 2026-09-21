import { Router } from "express";
import { z } from "zod";
import { planifierProduction } from "../utils/planifierProduction.js";

const router = Router();
const schema = z.object({
  recetteId: z.number().int().positive(),
  depotId: z.number().int().positive().optional(),
  cible: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("portions"), valeur: z.number().positive() }),
    z.object({ mode: z.literal("poidsFiniG"), valeur: z.number().positive() }),
  ]),
});

router.post("/planifier", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données de production invalides", details: parsed.error.flatten() });
    return;
  }
  try {
    res.json(await planifierProduction(parsed.data.recetteId, parsed.data.cible, parsed.data.depotId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de planifier la production";
    res.status(message === "Recette introuvable" ? 404 : 400).json({ error: message });
  }
});

export default router;
