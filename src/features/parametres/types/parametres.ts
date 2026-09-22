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
  // Coefficient multiplicateur (prix de vente = coût matière × coefficient) utilisé par l'agent
  // Consulting pour simuler un prix de vente et un food cost théorique quand une recette n'a pas
  // de prix de vente réel renseigné. Nullable et sans valeur par défaut délibérément : tant que ce
  // champ n'est pas explicitement configuré, Consulting ne simule rien (voir
  // server/routes/consulting.ts et l'audit de l'agent Consulting, constat A3).
  coefficientMultiplicateur: number | null;
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
