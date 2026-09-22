export interface UniteRecette {
  id: number;
  nom: string;
  symbole: string;
  facteurBase: number;
}

export interface AllergeneRecette {
  id: number;
  nom: string;
}

export interface ArticleRecette {
  id: number;
  nom: string;
  reference: string | null;
  rendement: number;
  tarifs: {
    prixHT: number;
    quantiteConditionnement: number;
    unite: { symbole: string; facteurBase: number };
    fournisseur: { id: number; nom: string };
  }[];
  allergenes: { allergene: AllergeneRecette }[];
}

export interface LigneRecette {
  id: number;
  articleId: number;
  quantite: number;
  uniteId: number;
  gainCuissonPct: number;
  unite: UniteRecette;
  article: ArticleRecette;
  coutLigne: number;
  poidsFiniLigneG: number;
}

export interface EtapeRecette {
  id: number;
  description: string;
  pointCritiqueHACCP: boolean;
  controleHACCP: string | null;
}

export interface Recette {
  id: number;
  nom: string;
  instructions: string | null;
  photo: string | null;
  categorieId: number | null;
  categorie: { id: number; nom: string } | null;
  sousCategorieId: number | null;
  sousCategorie: { id: number; nom: string } | null;
  portions: number;
  poidsPortionG: number | null;
  poidsAccompagnementG: number | null;
  prixVenteHT: number | null;
  lignes: LigneRecette[];
  etapes: EtapeRecette[];
  allergenes: AllergeneRecette[];
  coutTotal: number;
  coutParPortion: number;
  foodCostPct: number | null;
  margeHT: number | null;
  poidsFiniTotalG: number;
}

export type LigneRecetteInput = {
  articleId: number;
  quantite: number;
  uniteId: number;
  gainCuissonPct: number;
  // Texte d'ingrédient d'origine (avant rapprochement avec le catalogue), renseigné uniquement
  // pour une ligne issue d'un import texte/photo — sert à mémoriser la correspondance choisie par
  // l'utilisateur à l'enregistrement de la recette (voir RecetteForm.tsx), jamais envoyé tel quel
  // à la création/modification de la recette elle-même.
  texteIngredientImporte?: string;
};

export interface AliasIngredient {
  texteNormalise: string;
  articleId: number;
}

export type EtapeRecetteInput = {
  description: string;
  pointCritiqueHACCP: boolean;
  controleHACCP: string | null;
};

export interface IngredientExtrait {
  texteOriginal: string;
  nomExtrait: string;
  quantite: number | null;
  unite: string | null;
}

export interface ExtractionRecette {
  nom: string | null;
  portions: number | null;
  ingredients: IngredientExtrait[];
  etapes: EtapeRecetteInput[];
}

// Détection par mots-clés sur la description d'une étape (voir server/utils/haccp.ts) — une
// suggestion, jamais une preuve de conformité.
export interface RegleHACCP {
  code: string;
  nom: string;
  risque: string;
  mesurePreventive: string;
  limiteCritique: string;
  surveillance: string;
  actionCorrective: string;
}

// Résultat de l'évaluation HACCP d'une étape : aValider tient compte à la fois de la détection par
// mots-clés (reglesDetectees) et du signal humain explicite (pointCritiqueHACCP), l'un ou l'autre
// suffisant à exiger un contrôle documenté (controleHACCP non vide).
export interface EtapeEvalueeHACCP {
  id: number;
  reglesDetectees: RegleHACCP[];
  aValider: boolean;
}

export interface EvaluationHACCP {
  recetteId: number;
  recetteNom: string;
  etapes: EtapeEvalueeHACCP[];
}

// Changement de fournisseur pour un même article déjà utilisé dans la recette — jamais un
// remplacement d'un article par un autre (voir server/utils/suggestionsEconomie.ts).
export interface SuggestionFournisseur {
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
}

export type RecetteInput = {
  nom: string;
  categorieId: number | null;
  sousCategorieId: number | null;
  portions: number;
  poidsPortionG: number | null;
  poidsAccompagnementG: number | null;
  prixVenteHT: number | null;
  instructions: string | null;
  photo: string | null;
  lignes: LigneRecetteInput[];
  etapes: EtapeRecetteInput[];
};
