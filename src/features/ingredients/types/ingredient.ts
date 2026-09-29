// Les 8 valeurs nutritionnelles saisies "pour 100g" de l'unité de base de l'article (voir
// server/utils/coutRecette.ts, CHAMPS_NUTRITION) — chaque champ absent/null signifie "non saisi",
// jamais "zéro" (même convention que prixVenteHT ailleurs dans l'app).
export interface ValeursNutritionnelles {
  energie?: number | null;
  proteines?: number | null;
  glucides?: number | null;
  sucres?: number | null;
  lipides?: number | null;
  acidesGrasSatures?: number | null;
  fibres?: number | null;
  sel?: number | null;
}

export interface Ingredient {
  id: number;

  nom: string;
  reference?: string;
  codeBarres?: string;

  categorie: {
    id: number;
    nom: string;
  };

  rendement: number;

  tarifs: {
    prixHT: number;
    fournisseur: {
      nom: string;
    };
    unite: {
      id: number;
      symbole: string;
    };
  }[];

  stocks?: {
    quantite: number;
  }[];

  allergenes: {
    allergene: {
      id: number;
      nom: string;
      code: string;
    };
  }[];

  nutrition: ValeursNutritionnelles | null;
}

export interface Allergene {
  id: number;
  nom: string;
  code: string;
}