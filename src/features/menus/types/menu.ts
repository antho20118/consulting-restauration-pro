export interface RecetteMenu {
  id: number;
  nom: string;
  portions: number;
  coutParPortion: number;
}

export interface LigneMenu {
  id: number;
  recetteId: number;
  quantite: number;
  recette: RecetteMenu;
  coutLigne: number;
}

export interface Menu {
  id: number;
  nom: string;
  description: string | null;
  categorieId: number | null;
  categorie: { id: number; nom: string } | null;
  prixVenteHT: number | null;
  lignes: LigneMenu[];
  coutTotal: number;
  foodCostPct: number | null;
  margeHT: number | null;
}

export type LigneMenuInput = {
  recetteId: number;
  quantite: number;
};

export type MenuInput = {
  nom: string;
  description: string | null;
  categorieId: number | null;
  prixVenteHT: number | null;
  lignes: LigneMenuInput[];
};
