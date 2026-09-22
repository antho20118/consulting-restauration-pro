import prisma from "../prisma.js";
import { calculerCoutRecette, inclusionsRecette, prixParUniteBase } from "./coutRecette.js";
import { libelleUniteBase, versUniteBase } from "./uniteConversion.js";

// En dessous de ce seuil, l'écart de prix entre deux tarifs est trop faible pour valoir une
// suggestion (bruit d'arrondi ou différence négligeable) plutôt qu'une vraie économie exploitable.
const ECONOMIE_MIN_PCT = 10;
const NB_SUGGESTIONS_MAX = 5;

export type TarifPourComparaison = {
  id: number;
  prixHT: number;
  quantiteConditionnement: number;
  dateDebut: Date;
  unite: { facteurBase: number; symbole: string; type: string };
  fournisseur: { id: number; nom: string };
  conditionnement: { nom: string };
};

export type MeilleurTarifAlternatif = {
  tarifActuel: TarifPourComparaison;
  tarifAlternatif: TarifPourComparaison;
  prixActuelParUniteBase: number;
  prixAlternatifParUniteBase: number;
  economiePct: number;
};

function prixSansErreur(tarif: TarifPourComparaison): number | null {
  try {
    return prixParUniteBase(tarif);
  } catch {
    // Un tarif isolé aux données corrompues (prix négatif, conditionnement nul...) ne doit pas
    // empêcher de comparer les autres tarifs du même article — même principe de résilience que
    // calculerCoutsRecettesSansErreur dans coutRecette.ts.
    return null;
  }
}

// Détermine, parmi les tarifs ACTIFS d'un même Article, s'il existe un tarif réellement moins cher
// qu'un autre fournisseur, une fois ramené à l'unité de base (prixParUniteBase — la même
// normalisation que le moteur de coût, qui neutralise les conditionnements de tailles différentes :
// un tarif à prix affiché plus bas n'est pas forcément le moins cher une fois rapporté à l'unité).
//
// Ne compare JAMAIS deux Article différents : uniquement plusieurs tarifs d'un seul et même
// article. Une différence de catégorie, de prix affiché ou de coût brut ne constitue jamais une
// preuve de substituabilité entre deux articles — voir l'audit produit qui a identifié ce problème
// (suggestions du type « remplacer le poivre blanc par de l'eau »).
//
// Le tarif « actuel » est le plus récent (dateDebut desc) — la même convention que celle utilisée
// pour calculer le coût d'une recette (voir inclusionsRecette dans coutRecette.ts, qui sélectionne
// aussi le tarif actif le plus récent). Le tarif « alternatif » est le moins cher des autres tarifs
// actifs, seulement s'il est strictement moins cher et que l'écart dépasse ECONOMIE_MIN_PCT.
export function meilleurTarifAlternatif(tarifsActifs: TarifPourComparaison[]): MeilleurTarifAlternatif | null {
  if (tarifsActifs.length < 2) return null; // un seul tarif (ou aucun) : rien à comparer

  const triesParDate = [...tarifsActifs].sort((a, b) => b.dateDebut.getTime() - a.dateDebut.getTime());
  const tarifActuel = triesParDate[0];
  const prixActuelParUniteBase = prixSansErreur(tarifActuel);
  if (prixActuelParUniteBase == null || prixActuelParUniteBase <= 0) return null;

  let meilleurAlternatif: TarifPourComparaison | null = null;
  let meilleurPrix = prixActuelParUniteBase;

  for (const candidat of triesParDate.slice(1)) {
    const prix = prixSansErreur(candidat);
    if (prix != null && prix < meilleurPrix) {
      meilleurPrix = prix;
      meilleurAlternatif = candidat;
    }
  }

  if (!meilleurAlternatif) return null;

  const economiePct = ((prixActuelParUniteBase - meilleurPrix) / prixActuelParUniteBase) * 100;
  if (economiePct < ECONOMIE_MIN_PCT) return null;

  return {
    tarifActuel,
    tarifAlternatif: meilleurAlternatif,
    prixActuelParUniteBase,
    prixAlternatifParUniteBase: meilleurPrix,
    economiePct,
  };
}

export type SuggestionFournisseur = {
  ligneId: number;
  article: { id: number; nom: string };
  fournisseurActuel: { id: number; nom: string };
  fournisseurAlternatif: { id: number; nom: string };
  prixActuelParUniteBase: number;
  prixAlternatifParUniteBase: number;
  uniteBase: string;
  conditionnementActuel: { nom: string; quantiteConditionnement: number; uniteSymbole: string };
  conditionnementAlternatif: { nom: string; quantiteConditionnement: number; uniteSymbole: string };
  economieEuros: number;
  economiePct: number;
  nouveauFoodCostPct: number | null;
};

// Pour chaque ligne d'une recette, cherche si l'article utilisé a plusieurs tarifs fournisseurs
// actifs et, si l'un d'eux est réellement moins cher que le tarif actuellement retenu (voir
// meilleurTarifAlternatif), propose de changer de fournisseur pour ce même article — jamais de
// changer d'article. Chiffre l'économie réelle en euros sur la ligne (en tenant compte du
// rendement de l'article, déjà validé par calculerCoutRecette ci-dessous) et l'impact sur le food
// cost de la recette.
export async function suggestionsEconomieRecette(recetteId: number): Promise<SuggestionFournisseur[]> {
  const recette = await prisma.recette.findUnique({
    where: { id: recetteId },
    include: inclusionsRecette,
  });
  if (!recette) return [];

  // Valide au passage chaque ligne (quantité, unité, rendement) : par la suite, ligne.article.rendement
  // est garanti valide (0 < rendement <= 1000), calculerCoutRecette aurait déjà levé une erreur sinon.
  const recetteCalculee = calculerCoutRecette(recette);

  const articleIds = [...new Set(recette.lignes.map((ligne) => ligne.article.id))];
  const tousLesTarifsActifs = await prisma.tarifArticle.findMany({
    where: { articleId: { in: articleIds }, actif: true },
    include: { fournisseur: true, unite: true, conditionnement: true },
  });
  const tarifsParArticle = new Map<number, TarifPourComparaison[]>();
  for (const tarif of tousLesTarifsActifs) {
    const liste = tarifsParArticle.get(tarif.articleId) ?? [];
    liste.push(tarif);
    tarifsParArticle.set(tarif.articleId, liste);
  }

  const suggestions: SuggestionFournisseur[] = [];

  for (const ligne of recetteCalculee.lignes) {
    const tarifsActifs = tarifsParArticle.get(ligne.article.id) ?? [];
    const meilleur = meilleurTarifAlternatif(tarifsActifs);
    if (!meilleur) continue;

    const quantiteBase = versUniteBase(ligne.quantite, ligne.unite);
    const economieEuros =
      (quantiteBase * (meilleur.prixActuelParUniteBase - meilleur.prixAlternatifParUniteBase)) /
      (ligne.article.rendement / 100);

    const nouveauCoutTotal = recetteCalculee.coutTotal - economieEuros;
    const nouveauCoutParPortion = nouveauCoutTotal / recette.portions;
    const nouveauFoodCostPct =
      recette.prixVenteHT && recette.prixVenteHT > 0
        ? (nouveauCoutParPortion / recette.prixVenteHT) * 100
        : null;

    suggestions.push({
      ligneId: ligne.id,
      article: { id: ligne.article.id, nom: ligne.article.nom },
      fournisseurActuel: {
        id: meilleur.tarifActuel.fournisseur.id,
        nom: meilleur.tarifActuel.fournisseur.nom,
      },
      fournisseurAlternatif: {
        id: meilleur.tarifAlternatif.fournisseur.id,
        nom: meilleur.tarifAlternatif.fournisseur.nom,
      },
      prixActuelParUniteBase: meilleur.prixActuelParUniteBase,
      prixAlternatifParUniteBase: meilleur.prixAlternatifParUniteBase,
      uniteBase: libelleUniteBase(meilleur.tarifActuel.unite.type),
      conditionnementActuel: {
        nom: meilleur.tarifActuel.conditionnement.nom,
        quantiteConditionnement: meilleur.tarifActuel.quantiteConditionnement,
        uniteSymbole: meilleur.tarifActuel.unite.symbole,
      },
      conditionnementAlternatif: {
        nom: meilleur.tarifAlternatif.conditionnement.nom,
        quantiteConditionnement: meilleur.tarifAlternatif.quantiteConditionnement,
        uniteSymbole: meilleur.tarifAlternatif.unite.symbole,
      },
      economieEuros,
      economiePct: meilleur.economiePct,
      nouveauFoodCostPct,
    });
  }

  return suggestions
    .sort((a, b) => b.economieEuros - a.economieEuros)
    .slice(0, NB_SUGGESTIONS_MAX);
}
