import prisma from "../prisma.js";
import { calculerCoutRecette, inclusionsRecette } from "./coutRecette.js";

export type CibleProduction =
  | { mode: "portions"; valeur: number }
  | { mode: "poidsFiniG"; valeur: number };

export async function planifierProduction(recetteId: number, cible: CibleProduction, depotId?: number) {
  const recette = await prisma.recette.findUnique({
    where: { id: recetteId },
    include: inclusionsRecette,
  });
  if (!recette) throw new Error("Recette introuvable");

  const calculee = calculerCoutRecette(recette);
  const poidsBase = calculee.poidsFiniTotalG;
  const echelle = cible.mode === "portions"
    ? (recette.portions > 0 ? cible.valeur / recette.portions : 0)
    : (poidsBase > 0 ? cible.valeur / poidsBase : 0);

  if (!Number.isFinite(echelle) || echelle <= 0) throw new Error("Cible de production invalide");

  const stocks = depotId == null ? [] : await prisma.stock.findMany({ where: { depotId } });
  const stockByArticle = new Map(stocks.map((s) => [s.articleId, s.quantite]));

  const lignes = calculee.lignes.map((ligne) => {
    // ligne.quantite est exprimée dans l'unité choisie pour cette ligne de recette (ligne.unite),
    // pas dans l'unité de base — exactement comme dans coutRecette.ts, qui doit la convertir via
    // le même facteurBase avant de calculer un coût. Le stock, lui, est toujours en unité de base
    // (voir Stock.quantite). Sans cette conversion, quantiteProduction et besoinNet seraient faux
    // d'un facteur facteurBase dès qu'une ligne n'est pas déjà exprimée dans l'unité de base
    // (ex. kg au lieu de g, L au lieu de mL) — valide quel que soit facteurBase, pas seulement
    // pour kg/g.
    const quantiteBase = ligne.quantite * ligne.unite.facteurBase;
    const quantite = quantiteBase * echelle;
    const stockDisponible = stockByArticle.get(ligne.articleId) ?? 0;
    const besoinNet = Math.max(0, quantite - stockDisponible);
    return {
      articleId: ligne.articleId,
      article: ligne.article,
      unite: ligne.unite,
      quantiteRecette: ligne.quantite,
      quantiteProduction: quantite,
      stockDisponible,
      besoinNet,
      gainCuissonPct: ligne.gainCuissonPct,
    };
  });

  return {
    recetteId,
    recetteNom: recette.nom,
    mode: cible.mode,
    cible: cible.valeur,
    echelle,
    poidsFiniCibleG: poidsBase * echelle,
    portionsCible: recette.portions * echelle,
    lignes,
  };
}
