export interface Categorie {
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

export type UniteInput = {
  nom: string;
  symbole: string;
  type: string;
  facteurBase: number;
};
