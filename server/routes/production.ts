import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { planifierProduction } from "../utils/planifierProduction.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();
const schema = z.object({
  recetteId: z.number().int().positive(),
  depotId: z.number().int().positive().optional(),
  cible: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("portions"), valeur: z.number().positive() }),
    z.object({ mode: z.literal("poidsFiniG"), valeur: z.number().positive() }),
  ]),
});

router.post("/planifier", async (req: Request, res: Response) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données de production invalides", details: parsed.error.flatten() });
    return;
  }
  try {
    res.json(
      await planifierProduction(
        parsed.data.recetteId,
        parsed.data.cible,
        req.utilisateur!.societeId,
        parsed.data.depotId
      )
    );
  } catch (error) {
    // Seules les deux erreurs métier explicitement reconnues (levées par planifierProduction.ts)
    // gardent leur statut et leur message tels quels. Toute autre exception (violation
    // d'invariant, panne à la frontière d'accès aux données, etc.) suit désormais le même
    // traitement que les autres routes de calcul en lecture de l'application (voir le catch de
    // POST /achats/proposition, structurellement identique à celui-ci) : jamais le message brut
    // de l'exception au client, toujours journalisée via le même mécanisme central que le reste
    // de l'application (voir server/utils/journalErreurs.ts).
    if (error instanceof Error && error.message === "Recette introuvable") {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.message === "Cible de production invalide") {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de planifier la production" });
  }
});

export default router;
