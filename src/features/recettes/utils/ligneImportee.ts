import type {
  ArticleRecette,
  IngredientExtrait,
  LigneRecetteInput,
  MaterielExtrait,
  MaterielImporteInput,
  UniteRecette,
} from "../types/recette";
import { normaliserTexte as normaliser } from "./normaliserTexte";

export function trouverArticle(
  nomExtrait: string,
  articles: ArticleRecette[],
  aliasParTexte: Map<string, number>
): ArticleRecette | null {
  const cible = normaliser(nomExtrait);
  if (!cible) return null;

  // Une correspondance déjà validée par l'utilisateur lors d'un import précédent (voir
  // AliasIngredientImport côté serveur) prime sur la recherche approximative ci-dessous : c'est
  // justement pour corriger les cas où celle-ci se trompait ou ne trouvait rien.
  const articleIdMemorise = aliasParTexte.get(cible);
  if (articleIdMemorise) {
    const article = articles.find((a) => a.id === articleIdMemorise);
    if (article) return article;
  }

  const exact = articles.find((a) => normaliser(a.nom) === cible);
  if (exact) return exact;

  const correspondances = articles.filter(
    (a) => normaliser(a.nom).includes(cible) || cible.includes(normaliser(a.nom))
  );
  if (correspondances.length === 0) return null;

  // À correspondance approximative égale, le nom le plus proche en longueur de celui recherché
  // est le plus probable (évite de préférer un nom d'article très générique qui contiendrait le
  // terme cherché comme sous-chaîne, ex. « Farine » dans « Farine de sarrasin »).
  return correspondances.reduce((meilleur, actuel) =>
    Math.abs(normaliser(actuel.nom).length - cible.length) <
    Math.abs(normaliser(meilleur.nom).length - cible.length)
      ? actuel
      : meilleur
  );
}

export function trouverUnite(symbole: string | null, unites: UniteRecette[]): UniteRecette | null {
  if (!symbole) return null;
  return unites.find((u) => normaliser(u.symbole) === normaliser(symbole)) ?? null;
}

// Construit la ligne de recette préremplie pour un ingrédient extrait par IA/OCR : rapproche
// l'article et l'unité à partir du catalogue, SANS jamais deviner une valeur manquante.
//
// En particulier, contrairement à un ajout de ligne manuel (voir trouverUniteParDefaut, utilisé
// uniquement pour ce cas), une unité non reconnue reste à 0 (« non déterminée ») plutôt que de
// retomber sur le kg : un repli silencieux vers une unité de masse est invisible dans le
// formulaire (le champ a l'air normalement rempli) et peut fausser silencieusement le coût
// affiché si l'ingrédient n'est pas réellement pesé (voir l'audit import IA). La ligne reste
// bloquante à l'enregistrement tant qu'une unité n'a pas été choisie — voir ligneIncomplete() dans
// validationLignes.ts.
//
// De même, l'article rapproché automatiquement (par alias mémorisé, correspondance exacte ou
// recherche approximative — voir trouverArticle ci-dessus) est marqué articleConfirme: false,
// volontairement sans distinguer ces trois cas : rien n'indiquait jusqu'ici, dans le formulaire,
// qu'un article y avait été inséré par une décision automatique plutôt que choisi par
// l'utilisateur — ambigu en particulier pour les allergènes, qui en sont déduits. Seule une ligne
// sans aucun article trouvé (article == null, champ visiblement vide) n'a rien à signaler.
export function construireLigneImportee(
  ingredient: IngredientExtrait,
  articles: ArticleRecette[],
  unites: UniteRecette[],
  aliasParTexte: Map<string, number>
): LigneRecetteInput {
  const article = trouverArticle(ingredient.nomExtrait, articles, aliasParTexte);
  const unite = trouverUnite(ingredient.unite, unites);
  return {
    // 0 : pas de présélection, cohérent avec une ligne ajoutée manuellement — l'utilisateur
    // choisit lui-même l'article dans le champ de recherche si rien n'a été trouvé.
    articleId: article?.id ?? 0,
    articleConfirme: article == null,
    quantite: ingredient.quantite ?? 0,
    uniteId: unite?.id ?? 0,
    gainCuissonPct: 0,
    // Conservé jusqu'à l'enregistrement de la recette pour mémoriser le choix de l'utilisateur
    // s'il corrige ou complète l'article (voir RecetteForm.tsx).
    texteIngredientImporte: ingredient.nomExtrait,
  };
}

// Même logique que construireLigneImportee ci-dessus, pour le matériel détecté à l'import : jamais
// de rapprochement avec un article alimentaire, même par erreur d'appelant — le filtre sur
// TypeArticle.PETIT_MATERIEL est donc appliqué ici, pas délégué à qui appelle cette fonction (voir
// la refonte de l'import photo/texte, règle « ne jamais transformer silencieusement un matériel
// extrait en article alimentaire »).
export function construireMaterielImporte(
  materiel: MaterielExtrait,
  articles: ArticleRecette[],
  aliasParTexte: Map<string, number>
): MaterielImporteInput {
  const articlesMateriel = articles.filter((a) => a.type === "PETIT_MATERIEL");
  const article = trouverArticle(materiel.nomExtrait, articlesMateriel, aliasParTexte);
  return {
    articleId: article?.id ?? 0,
    articleConfirme: article == null,
    confiance: materiel.confiance,
    texteMaterielImporte: materiel.nomExtrait,
  };
}

// Convertit un matériel rapproché en ligne de recette ordinaire (RecetteLigne) : TypeArticle.
// PETIT_MATERIEL passe déjà par ce même mécanisme pour tout le reste de l'application (coût,
// affichage...) — voir l'audit qui a motivé ce choix plutôt que d'inventer un stockage dédié.
// Quantité/unité ne sont jamais devinées depuis le document (le matériel n'est généralement pas
// quantifié dans une recette) : 1 pièce par défaut, à ajuster ou ignorer par l'utilisateur comme
// n'importe quelle ligne fraîchement ajoutée.
export function materielVersLigne(
  materielImporte: MaterielImporteInput,
  unites: UniteRecette[]
): LigneRecetteInput {
  const unitePiece = unites.find((u) => normaliser(u.symbole) === normaliser("pièce"));
  return {
    articleId: materielImporte.articleId,
    articleConfirme: materielImporte.articleConfirme,
    quantite: materielImporte.articleId ? 1 : 0,
    uniteId: unitePiece?.id ?? 0,
    gainCuissonPct: 0,
    texteIngredientImporte: materielImporte.texteMaterielImporte,
  };
}
