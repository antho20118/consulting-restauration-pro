export interface Categorie {
  id: number;
  nom: string;
}

export interface CategorieRecette {
  id: number;
  nom: string;
}

export interface Unite {
  id: number;
  nom: string;
  symbole: string;
  type: string;
  facteurBase: number;
}

export interface Societe {
  id: number;
  nom: string;
}

export interface Tva {
  id: number;
  nom: string;
  taux: number;
}

export type UniteInput = {
  nom: string;
  symbole: string;
  type: string;
  facteurBase: number;
};

export type TvaInput = {
  nom: string;
  taux: number;
};
