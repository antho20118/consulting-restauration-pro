export interface Categorie {
  id: number;
  nom: string;
}

export interface CategorieRecette {
  id: number;
  nom: string;
}

export interface SousCategorieRecette {
  id: number;
  nom: string;
  // Hiérarchie à un niveau (voir prisma/schema.prisma) : null pour une sous-catégorie racine,
  // sinon l'id d'une sous-catégorie racine — jamais l'id d'une autre sous-catégorie enfant (pas
  // de chaîne à plusieurs niveaux, pas de cycle), contrainte imposée ici côté choix proposés à
  // l'utilisateur (voir SousCategoriesRecetteManager.tsx), le serveur n'imposant pas cette limite
  // lui-même.
  parentId: number | null;
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
