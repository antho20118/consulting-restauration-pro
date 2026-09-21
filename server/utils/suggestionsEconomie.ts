import prisma from "../prisma.js";
import { calculerCoutRecette, inclusionsRecette } from "./coutRecette.js";
import { versUniteBase } from "./uniteConversion.js";

// En dessous de ce seuil, l'écart de prix entre deux articles est trop faible pour valoir une
// suggestion (bruit d'arrondi ou différence négligeable) plutôt qu'une vraie économie exploitable.
const ECONOMIE_MIN_PCT = 10;
const NB_SUGGESTIONS_MAX = 5;

export type ArticleAvecTarif = {
  id: number;
  nom: string;
  categorieId: number;
  rendement: number;
  tarifs: { prixHT: number; quantiteConditionnement: number; unite: { facteurBase: number } }[];
};

// Coût réel supporté par gramme (ou mL, ou pièce...) de base d'un article, une fois le rendement
// (perte à la préparation) pris en compte — la même métrique que celle utilisée pour le coût des
// recettes (voir coutRecette.ts), ce qui permet de comparer équitablement deux articles vendus
// dans des unités différentes (ex. le kg contre la pièce).
//
// Un candidat sans tarif actif ou avec un rendement invalide (<= 0 ou > 1000, même borne que
// rendementValide() dans coutRecette.ts) est écarté (null) plutôt que de retomber sur une valeur
// par défaut supposée (comme le fait calculerCoutRecette pour la recette elle-même, en throw) : un
// seul mauvais candidat de substitution ne doit pas empêcher de calculer des suggestions pour les
// autres. Sans cette borne haute, un article au rendement aberrant (ex. saisi à 5000 au lieu de
// 100, une erreur de saisie plausible) produirait un coût effectif artificiellement bas et serait
// suggéré comme substitution moins chère sur la seule foi d'une donnée corrompue.
export function coutEffectifParUniteBase(article: ArticleAvecTarif): number | null {
  const tarif = article.tarifs[0];
  if (!tarif) return null;
  if (!Number.isFinite(article.rendement) || article.rendement <= 0 || article.rendement > 1000) return null;

  const prixParUniteBase =
    tarif.prixHT / (tarif.quantiteConditionnement * tarif.unite.facteurBase);
  return prixParUniteBase / (article.rendement / 100);
}

export type SuggestionEconomie = {
  ligneId: number;
  articleActuel: { id: number; nom: string };
  articleSuggere: { id: number; nom: string };
  economieParPortion: number;
  economiePct: number;
  nouveauFoodCostPct: number | null;
};

// Pour chaque ligne d'une recette, cherche dans la même catégorie d'ingrédients un article moins
// cher à rendement équivalent (ex. un autre fournisseur, une autre référence) qui ferait baisser le
// coût de la recette, en simulant le remplacement pour chiffrer l'économie réelle par portion et
// l'impact sur le food cost.
export async function suggestionsEconomieRecette(recetteId: number): Promise<SuggestionEconomie[]> {
  const recette = await prisma.recette.findUnique({
    where: { id: recetteId },
    include: inclusionsRecette,
  });
  if (!recette) return [];

  const recetteCalculee = calculerCoutRecette(recette);

  const categorieIds = [...new Set(recette.lignes.map((ligne) => ligne.article.categorieId))];
  const candidats = await prisma.article.findMany({
    where: { categorieId: { in: categorieIds }, actif: true },
    include: {
      tarifs: { where: { actif: true }, orderBy: { dateDebut: "desc" }, take: 1, include: { unite: true } },
    },
  });
  const candidatsParCategorie = new Map<number, ArticleAvecTarif[]>();
  for (const candidat of candidats) {
    const liste = candidatsParCategorie.get(candidat.categorieId) ?? [];
    liste.push(candidat);
    candidatsParCategorie.set(candidat.categorieId, liste);
  }

  const suggestions: SuggestionEconomie[] = [];

  for (const ligne of recetteCalculee.lignes) {
    const coutActuelParUniteBase = coutEffectifParUniteBase(ligne.article);
    if (coutActuelParUniteBase == null || coutActuelParUniteBase <= 0) continue;

    const candidatsCategorie = candidatsParCategorie.get(ligne.article.categorieId) ?? [];
    let meilleurCandidat: ArticleAvecTarif | null = null;
    let meilleurCout = coutActuelParUniteBase;

    for (const candidat of candidatsCategorie) {
      if (candidat.id === ligne.article.id) continue;
      const cout = coutEffectifParUniteBase(candidat);
      if (cout != null && cout < meilleurCout) {
        meilleurCout = cout;
        meilleurCandidat = candidat;
      }
    }

    if (!meilleurCandidat) continue;

    const economiePct = ((coutActuelParUniteBase - meilleurCout) / coutActuelParUniteBase) * 100;
    if (economiePct < ECONOMIE_MIN_PCT) continue;

    const quantiteBase = versUniteBase(ligne.quantite, ligne.unite);
    const nouveauCoutLigne = quantiteBase * meilleurCout;
    const economieTotale = ligne.coutLigne - nouveauCoutLigne;
    // recette.portions est garanti > 0 : calculerCoutRecette() a déjà validé la recette ci-dessus.
    const economieParPortion = economieTotale / recette.portions;

    const nouveauCoutTotal = recetteCalculee.coutTotal - economieTotale;
    const nouveauCoutParPortion = nouveauCoutTotal / recette.portions;
    const nouveauFoodCostPct =
      recette.prixVenteHT && recette.prixVenteHT > 0
        ? (nouveauCoutParPortion / recette.prixVenteHT) * 100
        : null;

    suggestions.push({
      ligneId: ligne.id,
      articleActuel: { id: ligne.article.id, nom: ligne.article.nom },
      articleSuggere: { id: meilleurCandidat.id, nom: meilleurCandidat.nom },
      economieParPortion,
      economiePct,
      nouveauFoodCostPct,
    });
  }

  return suggestions
    .sort((a, b) => b.economieParPortion - a.economieParPortion)
    .slice(0, NB_SUGGESTIONS_MAX);
}
