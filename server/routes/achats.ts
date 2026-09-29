import { Router } from "express";
import { z } from "zod";
import { calculerPropositionAchat } from "../utils/propositionAchat.js";

const router = Router();

const schema = z.object({
  depotId: z.number().int().positive().optional(),
  besoins: z.array(
    z.object({
      articleId: z.number().int().positive(),
      quantite: z.number().positive(),
      facteurUniteRecette: z.number().positive(),
    })
  ),
});

// Propose une commande fournisseur à partir d'une liste de besoins — lecture seule, n'écrit jamais
// en base (voir calculerPropositionAchat, server/utils/propositionAchat.ts, également réutilisée
// par POST /commandes pour l'enregistrement réel).
router.post("/proposition", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Besoins d'achat invalides", details: parsed.error.flatten() });
    return;
  }

  try {
    const { besoins, depotId } = parsed.data;
    const proposition = await calculerPropositionAchat(besoins, depotId);
    res.json(proposition);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de générer la proposition d'achat" });
  }
});

export default router;
