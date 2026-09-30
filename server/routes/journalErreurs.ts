import { Router } from "express";
import prisma from "../prisma.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// Monté sous /api/journal-erreurs avec requireRole(["PROPRIETAIRE"]) (voir app.ts) : une entrée
// peut révéler des détails d'implémentation (route, pile d'appel), jamais réservé à un CHEF,
// CUISINIER ou CONSULTANT. Inclut aussi les entrées sans société (erreurs survenues avant qu'un
// jeton ait pu être décodé, ex. celle qui a motivé ce journal) : elles ne portent aucune donnée
// métier d'une autre société, seulement un message/pile technique générique.
router.get("/", async (req, res) => {
  try {
    const societeId = req.utilisateur!.societeId;
    const entrees = await prisma.journalErreur.findMany({
      where: { OR: [{ societeId }, { societeId: null }] },
      orderBy: { moment: "desc" },
      take: 100,
    });
    res.json(entrees);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer le journal des erreurs" });
  }
});

export default router;
