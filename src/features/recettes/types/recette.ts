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
  rendement: number;
  tarifs: {
    prixHT: number;
    unite: { symbole: string; facteurBase: number };
  }[];
  allergenes: { allergene: AllergeneRecette }[];
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
  portions: number;
  prixVenteHT: number | null;
  lignes: LigneRecette[];
  etapes: EtapeRecette[];
  allergenes: AllergeneRecette[];
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

export type EtapeRecetteInput = {
  description: string;
  pointCritiqueHACCP: boolean;
  controleHACCP: string | null;
};

export type RecetteInput = {
  nom: string;
  categorieId: number | null;
  portions: number;
  prixVenteHT: number | null;
  instructions: string | null;
  photo: string | null;
  lignes: LigneRecetteInput[];
  etapes: EtapeRecetteInput[];
};
