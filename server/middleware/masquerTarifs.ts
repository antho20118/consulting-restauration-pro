import type { Request, Response, NextFunction } from "express";
import { requireRole } from "./requireRole.js";

// Décision du 15/10 (point 7 de l'audit) : « Les cuisiniers ne doivent voir aucun tarif. » Deux
// niveaux, posés dans server/app.ts avec le reste de la matrice des rôles :
// 1. les écrans purement financiers (achats, fournisseurs, ventes, analyses, tableau de bord) sont
//    entièrement fermés au CUISINIER (fermeAuCuisinier) ;
// 2. partout ailleurs, chaque réponse JSON qui lui est envoyée est expurgée de ses montants
//    (masquerTarifsCuisinier). Un filtre unique, appliqué à la sortie, plutôt qu'un « select »
//    route par route : un champ de prix ajouté demain à une réponse existante lui reste masqué sans
//    y penser.
//
// Visés : les montants et leurs dérivés (prix d'achat et de vente, coûts, marges, food cost,
// montants, économies, chiffre d'affaires, valeur du stock, coefficient multiplicateur). Un tarif
// lui-même (unité d'achat, fournisseur) n'est pas un prix : l'écran des mouvements de stock en a
// besoin pour proposer la bonne unité, il reste donc, sans son prix.
const CHAMP_DE_PRIX = /^(prix|cout|marge|foodCost|montant|economie|chiffreAffaires)/i;
const CHAMPS_DE_PRIX_EXACTS = new Set(["valeurStock", "coefficientMultiplicateur"]);

export function estChampDePrix(cle: string): boolean {
  return CHAMP_DE_PRIX.test(cle) || CHAMPS_DE_PRIX_EXACTS.has(cle);
}

export function retirerTarifs(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(retirerTarifs);
  if (valeur instanceof Date || valeur === null || typeof valeur !== "object") return valeur;
  const resultat: Record<string, unknown> = {};
  for (const [cle, sous] of Object.entries(valeur)) {
    if (!estChampDePrix(cle)) resultat[cle] = retirerTarifs(sous);
  }
  return resultat;
}

export function voitLesTarifs(req: Request): boolean {
  return req.utilisateur?.role !== "CUISINIER";
}

export function masquerTarifsCuisinier(req: Request, res: Response, next: NextFunction) {
  if (voitLesTarifs(req)) {
    next();
    return;
  }
  const json = res.json.bind(res);
  res.json = (corps?: unknown) => json(retirerTarifs(corps));
  next();
}

export const fermeAuCuisinier = requireRole(["PROPRIETAIRE", "CHEF", "CONSULTANT"]);
