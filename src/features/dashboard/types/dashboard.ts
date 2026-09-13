export interface RecetteAlerte {
  id: number;
  nom: string;
  foodCostPct: number;
  coutParPortion: number;
  prixVenteHT: number;
}

export interface RepartitionCategorie {
  categorie: string;
  count: number;
}

export interface DashboardData {
  nbIngredients: number;
  nbRecettes: number;
  valeurStock: number;
  foodCostMoyen: number | null;
  recettesAlerte: RecetteAlerte[];
  repartitionCategories: RepartitionCategorie[];
}
