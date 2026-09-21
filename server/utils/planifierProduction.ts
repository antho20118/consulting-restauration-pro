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
    const quantite = ligne.quantite * echelle;
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
