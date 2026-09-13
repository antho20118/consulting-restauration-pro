export interface UniteRecette {
  id: number;
  nom: string;
  symbole: string;
  facteurBase: number;
}

export interface ArticleRecette {
  id: number;
  nom: string;
  rendement: number;
  tarifs: {
    prixHT: number;
    unite: { symbole: string; facteurBase: number };
  }[];
}

export interface LigneRecette {
  id: number;
  articleId: number;
  quantite: number;
  uniteId: number;
  unite: UniteRecette;
  article: ArticleRecette;
  coutLigne: number;
}

export interface Recette {
  id: number;
  nom: string;
  instructions: string | null;
  categorieId: number | null;
  categorie: { id: number; nom: string } | null;
  portions: number;
  prixVenteHT: number | null;
  lignes: LigneRecette[];
  coutTotal: number;
  coutParPortion: number;
  foodCostPct: number | null;
  margeHT: number | null;
}

export type LigneRecetteInput = {
  articleId: number;
  quantite: number;
  uniteId: number;
};

export type RecetteInput = {
  nom: string;
  categorieId: number | null;
  portions: number;
  prixVenteHT: number | null;
  instructions: string | null;
  lignes: LigneRecetteInput[];
};
