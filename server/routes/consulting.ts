import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma.js";
import { calculerCoutRecette, inclusionsRecette } from "../utils/coutRecette.js";
import { evaluerEtapesHACCP } from "../utils/haccp.js";

const router = Router();
const schema = z.object({ recetteId: z.number().int().positive() });

// Première couche de l'agent Consulting : une analyse déterministe (aucun appel à un modèle de
// langage) d'une recette existante — coût, food cost, marge, poids fini, alertes sur les tarifs
// manquants et les points HACCP à valider. Purement en lecture, ne modifie jamais la recette :
// sert de base factuelle à laquelle une couche LLM pourra s'appuyer plus tard, sans jamais lui
// laisser modifier directement les données métier (recette, prix, stock, règle HACCP) sans
// validation explicite de l'utilisateur.
router.post("/analyser-recette", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "recetteId invalide" });
    return;
  }

  try {
    const recette = await prisma.recette.findUnique({
      where: { id: parsed.data.recetteId },
      include: inclusionsRecette,
    });
    if (!recette) {
      res.status(404).json({ error: "Recette introuvable" });
      return;
    }

    const calcule = calculerCoutRecette(recette);
    const haccp = evaluerEtapesHACCP(recette.etapes);

    const alertes: string[] = [];
    // Toujours un signal explicite sur le food cost, jamais un silence : sans prix de vente
    // renseigné, foodCostPct est null et la comparaison à 35 % ne peut mathématiquement pas avoir
    // lieu — mais l'absence d'alerte ne doit jamais se confondre avec "vérifié, food cost correct"
    // (voir l'audit de l'agent Consulting, constat A3 : un coût matière élevé sans prix de vente
    // ne déclenchait auparavant aucune alerte du tout).
    if (calcule.foodCostPct == null) {
      alertes.push("Food cost non évaluable : prix de vente non renseigné (ou nul)");
    } else if (calcule.foodCostPct > 35) {
      alertes.push("Food cost supérieur à 35 %");
    }
    if (calcule.coutParPortion <= 0) alertes.push("Coût matière nul ou non tarifé");
    if (haccp.some((e) => e.aValider)) alertes.push("Des étapes nécessitent une validation HACCP");
    if (recette.lignes.some((l) => l.article.tarifs.length === 0)) {
      alertes.push("Au moins un ingrédient n'a pas de tarif actif");
    }

    res.json({
      recetteId: recette.id,
      recetteNom: recette.nom,
      indicateurs: {
        coutTotal: calcule.coutTotal,
        coutParPortion: calcule.coutParPortion,
        foodCostPct: calcule.foodCostPct,
        margeHT: calcule.margeHT,
        poidsFiniTotalG: calcule.poidsFiniTotalG,
      },
      alertes,
      haccp,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible d'analyser la recette" });
  }
});

export default router;
