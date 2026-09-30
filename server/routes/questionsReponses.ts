import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";
import { calculerCoutsRecettesSansErreur, inclusionsRecette } from "../utils/coutRecette.js";
import { SEUIL_BON, niveauFoodCost } from "../utils/seuilsFoodCost.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// Catalogue fixe de questions métier, chacune répondue par une requête déterministe sur les
// données déjà en base (moteur de coût, menu engineering, achats, stock) — jamais un appel à un
// modèle de langage : voir la discussion produit sur le coût d'une IA générative pour cette
// fonctionnalité, tranchée en faveur d'une version gratuite d'abord. Une question libre appuyée
// sur un LLM pourra être ajoutée plus tard en façade, sans remettre en cause ce catalogue qui
// restera la base "sans coût" de la fonctionnalité.
export const CATALOGUE_QUESTIONS = [
  { cle: "recette-plus-rentable", question: "Quelle est ma recette la plus rentable ?" },
  { cle: "recette-moins-rentable", question: "Quelle est ma recette la moins rentable ?" },
  { cle: "food-cost-moyen", question: "Quel est mon food cost moyen actuellement ?" },
  { cle: "recettes-food-cost-critique", question: "Quelles recettes ont un food cost trop élevé ?" },
  { cle: "recettes-vedettes", question: "Quelles sont mes recettes vedettes (best-sellers rentables) ?" },
  { cle: "recettes-a-retravailler", question: "Quelles recettes devrais-je retravailler ou retirer du menu ?" },
  { cle: "ingredients-sans-tarif", question: "Quels ingrédients n'ont pas de tarif actif ?" },
  { cle: "commandes-en-attente", question: "Quelles commandes fournisseurs sont en attente de réception ?" },
  { cle: "valeur-stock", question: "Quelle est la valeur actuelle de mon stock ?" },
] as const;

type CleQuestion = (typeof CATALOGUE_QUESTIONS)[number]["cle"];

function formaterEuros(valeur: number): string {
  return `${valeur.toFixed(2)} €`;
}

async function repondre(cle: CleQuestion, societeId: number): Promise<{ reponse: string; details?: unknown }> {
  switch (cle) {
    case "recette-plus-rentable":
    case "recette-moins-rentable": {
      const recettes = calculerCoutsRecettesSansErreur(
        await prisma.recette.findMany({ where: { societeId, actif: true }, include: inclusionsRecette })
      ).filter((r) => r.margeHT != null);
      if (recettes.length === 0) {
        return {
          reponse: "Aucune recette n'a de prix de vente renseigné pour l'instant — impossible de calculer une marge.",
        };
      }
      const tri = [...recettes].sort((a, b) =>
        cle === "recette-plus-rentable" ? b.margeHT! - a.margeHT! : a.margeHT! - b.margeHT!
      );
      const retenue = tri[0];
      const qualificatif = cle === "recette-plus-rentable" ? "la plus rentable" : "la moins rentable";
      return {
        reponse: `${retenue.nom} est ${qualificatif}, avec une marge de ${formaterEuros(retenue.margeHT!)} par portion.`,
        details: { recetteId: retenue.id, recetteNom: retenue.nom, margeHT: retenue.margeHT },
      };
    }

    case "food-cost-moyen": {
      const recettes = calculerCoutsRecettesSansErreur(
        await prisma.recette.findMany({ where: { societeId, actif: true }, include: inclusionsRecette })
      );
      const valeurs = recettes.map((r) => r.foodCostPct).filter((v): v is number => v != null);
      if (valeurs.length === 0) {
        return {
          reponse: "Aucune recette n'a de prix de vente renseigné pour l'instant — impossible de calculer un food cost.",
        };
      }
      const moyenne = valeurs.reduce((total, v) => total + v, 0) / valeurs.length;
      return {
        reponse: `Le food cost moyen sur tes recettes tarifées est de ${moyenne.toFixed(1)} % (${niveauFoodCost(moyenne)}).`,
        details: { foodCostMoyen: moyenne },
      };
    }

    case "recettes-food-cost-critique": {
      const recettes = calculerCoutsRecettesSansErreur(
        await prisma.recette.findMany({ where: { societeId, actif: true }, include: inclusionsRecette })
      );
      const critiques = recettes
        .filter((r) => r.foodCostPct != null && r.foodCostPct > SEUIL_BON)
        .sort((a, b) => (b.foodCostPct ?? 0) - (a.foodCostPct ?? 0));
      if (critiques.length === 0) {
        return { reponse: "Aucune recette n'a un food cost au-dessus du seuil — tout va bien de ce côté." };
      }
      const liste = critiques
        .slice(0, 5)
        .map((r) => `${r.nom} (${r.foodCostPct!.toFixed(1)} %)`)
        .join(", ");
      return {
        reponse: `${critiques.length} recette(s) au-dessus du seuil de ${SEUIL_BON} % : ${liste}${critiques.length > 5 ? "…" : ""}.`,
        details: { recettes: critiques.map((r) => ({ id: r.id, nom: r.nom, foodCostPct: r.foodCostPct })) },
      };
    }

    // Même méthode Kasavana & Smith que GET /api/ventes/menu-engineering (server/routes/ventes.ts)
    // — reprise ici plutôt qu'appelée en interne pour rester sur une seule requête HTTP côté client.
    case "recettes-vedettes":
    case "recettes-a-retravailler": {
      const [recettes, lignesValidees] = await Promise.all([
        prisma.recette.findMany({ where: { societeId, actif: true }, include: inclusionsRecette }),
        prisma.ligneVente.findMany({
          where: { decision: "VALIDEE", recetteRetenueId: { not: null }, documentVentes: { societeId } },
          select: { recetteRetenueId: true, quantiteVendue: true },
        }),
      ]);

      const quantiteParRecette = new Map<number, number>();
      for (const ligne of lignesValidees) {
        const id = ligne.recetteRetenueId!;
        quantiteParRecette.set(id, (quantiteParRecette.get(id) ?? 0) + ligne.quantiteVendue);
      }

      const items = calculerCoutsRecettesSansErreur(recettes)
        .filter((r) => r.prixVenteHT != null && r.prixVenteHT > 0)
        .map((r) => ({
          id: r.id,
          nom: r.nom,
          margeUnitaire: r.margeHT!,
          quantiteVendue: quantiteParRecette.get(r.id) ?? 0,
        }));

      if (items.length === 0) {
        return {
          reponse: "Aucune recette n'a de prix de vente renseigné pour l'instant — impossible de faire ce classement.",
        };
      }
      const totalQuantite = items.reduce((total, item) => total + item.quantiteVendue, 0);
      if (totalQuantite === 0) {
        return {
          reponse:
            "Aucune vente validée pour l'instant — importe des ventes pour que ce classement devienne pertinent (voir Menu engineering).",
        };
      }
      const seuilPopulariteQuantite = 0.7 * (totalQuantite / items.length);
      const margeMoyennePonderee =
        items.reduce((total, item) => total + item.margeUnitaire * item.quantiteVendue, 0) / totalQuantite;

      const classes = items.map((item) => {
        const populaire = item.quantiteVendue >= seuilPopulariteQuantite;
        const rentable = item.margeUnitaire >= margeMoyennePonderee;
        const quadrant = populaire && rentable ? "VEDETTE" : !populaire && !rentable ? "POIDS_MORT" : null;
        return { ...item, quadrant };
      });

      if (cle === "recettes-vedettes") {
        const vedettes = classes.filter((c) => c.quadrant === "VEDETTE").sort((a, b) => b.quantiteVendue - a.quantiteVendue);
        if (vedettes.length === 0) {
          return { reponse: "Aucune recette ne ressort comme vedette pour l'instant (voir Menu engineering)." };
        }
        return {
          reponse: `${vedettes.length} recette(s) vedette(s) : ${vedettes.map((v) => v.nom).join(", ")}.`,
          details: { recettes: vedettes },
        };
      }
      const aRetravailler = classes.filter((c) => c.quadrant === "POIDS_MORT").sort((a, b) => a.margeUnitaire - b.margeUnitaire);
      if (aRetravailler.length === 0) {
        return { reponse: "Aucune recette ne ressort comme un poids mort pour l'instant (voir Menu engineering)." };
      }
      return {
        reponse: `${aRetravailler.length} recette(s) à retravailler ou retirer : ${aRetravailler.map((r) => r.nom).join(", ")}.`,
        details: { recettes: aRetravailler },
      };
    }

    case "ingredients-sans-tarif": {
      const articles = await prisma.article.findMany({
        where: { societeId, actif: true },
        select: { id: true, nom: true, tarifs: { where: { actif: true }, select: { id: true } } },
      });
      const sansTarif = articles.filter((a) => a.tarifs.length === 0);
      if (sansTarif.length === 0) {
        return { reponse: "Tous tes ingrédients actifs ont un tarif actif configuré." };
      }
      return {
        reponse: `${sansTarif.length} ingrédient(s) sans tarif actif : ${sansTarif.map((a) => a.nom).join(", ")}.`,
        details: { articles: sansTarif.map((a) => ({ id: a.id, nom: a.nom })) },
      };
    }

    case "commandes-en-attente": {
      const commandes = await prisma.commandeFournisseur.findMany({
        where: { statut: "EN_ATTENTE", fournisseur: { societeId } },
        include: { fournisseur: { select: { nom: true } } },
        orderBy: { creeLe: "asc" },
      });
      if (commandes.length === 0) {
        return { reponse: "Aucune commande fournisseur en attente de réception." };
      }
      const liste = commandes.map((c) => `${c.fournisseur.nom} (${c.creeLe.toLocaleDateString("fr-FR")})`).join(", ");
      return {
        reponse: `${commandes.length} commande(s) en attente de réception : ${liste}.`,
        details: { commandes: commandes.map((c) => ({ id: c.id, fournisseurNom: c.fournisseur.nom, creeLe: c.creeLe })) },
      };
    }

    case "valeur-stock": {
      const stocks = await prisma.stock.findMany({
        where: { depot: { societeId } },
        include: { article: { include: { tarifs: { where: { actif: true }, orderBy: { dateDebut: "desc" }, take: 1 } } } },
      });
      const valeur = stocks.reduce((total, stock) => {
        const tarif = stock.article.tarifs[0];
        return total + (tarif ? stock.quantite * tarif.prixHT : 0);
      }, 0);
      return {
        reponse: `La valeur actuelle de ton stock est estimée à ${formaterEuros(valeur)}.`,
        details: { valeurStock: valeur },
      };
    }

    default: {
      const exhaustif: never = cle;
      throw new Error(`Question inconnue : ${exhaustif}`);
    }
  }
}

router.get("/", (_req: Request, res: Response) => {
  res.json(CATALOGUE_QUESTIONS);
});

router.get("/:cle", async (req: Request, res: Response) => {
  const cle = req.params.cle as string;
  const trouvee = CATALOGUE_QUESTIONS.find((q) => q.cle === cle);
  if (!trouvee) {
    res.status(404).json({ error: "Question inconnue" });
    return;
  }

  try {
    const resultat = await repondre(cle as CleQuestion, req.utilisateur!.societeId);
    res.json({ cle, question: trouvee.question, ...resultat });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de calculer la réponse à cette question" });
  }
});

export default router;
