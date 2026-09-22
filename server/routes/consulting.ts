import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma.js";
import { calculerCoutRecette, inclusionsRecette } from "../utils/coutRecette.js";
import { evaluerEtapesHACCP } from "../utils/haccp.js";
import { SEUIL_BON, SEUIL_ATTENTION, niveauFoodCost } from "../utils/seuilsFoodCost.js";

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
    let simulation: { coefficient: number; prixVenteEstimeHT: number; foodCostTheoriquePct: number } | null = null;

    // Trois cas, jamais un silence pour les deux derniers (voir l'audit de l'agent Consulting,
    // constat A3, et la discussion qui a suivi la correction initiale en PR #65) :
    // 1. Prix de vente réel renseigné -> food cost réel, comparé aux mêmes seuils que le tableau
    //    de bord (voir server/utils/seuilsFoodCost.ts — auparavant Consulting n'alertait qu'au
    //    palier "Critique" en dur, ignorant silencieusement le palier "À surveiller" affiché
    //    partout ailleurs pour la même donnée : incohérence trouvée en revue après la fusion de
    //    PR #66, corrigée ici sans changer les valeurs de seuil elles-mêmes).
    // 2. Prix absent mais un coefficient multiplicateur est configuré pour la société (voir
    //    Societe.coefficientMultiplicateur, jamais de valeur par défaut) -> on simule un prix de
    //    vente et un food cost théorique, explicitement marqués comme une estimation — jamais une
    //    alerte, ce n'est pas un problème mais une information.
    // 3. Prix absent et aucun coefficient configuré -> on ne peut réellement rien évaluer, et on
    //    le dit, plutôt que de laisser un tableau d'alertes vide se faire passer pour "vérifié".
    if (calcule.foodCostPct != null) {
      const niveau = niveauFoodCost(calcule.foodCostPct);
      if (niveau === "critique") {
        alertes.push(`Food cost critique : supérieur à ${SEUIL_ATTENTION} %`);
      } else if (niveau === "attention") {
        alertes.push(`Food cost à surveiller : compris entre ${SEUIL_BON} % et ${SEUIL_ATTENTION} %`);
      }
      // niveau === "bon" : aucune alerte, comportement inchangé.
    } else {
      const societe = await prisma.societe.findUnique({
        where: { id: recette.societeId },
        select: { coefficientMultiplicateur: true },
      });
      const coefficient = societe?.coefficientMultiplicateur;

      if (coefficient) {
        simulation = {
          coefficient,
          prixVenteEstimeHT: calcule.coutParPortion * coefficient,
          foodCostTheoriquePct: 100 / coefficient,
        };
      } else {
        alertes.push(
          "Food cost non évaluable : prix de vente non renseigné et aucun coefficient multiplicateur configuré (voir Paramètres)"
        );
      }
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
      simulation,
      alertes,
      haccp,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible d'analyser la recette" });
  }
});

export default router;
