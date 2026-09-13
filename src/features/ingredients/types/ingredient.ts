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
}

export interface Allergene {
  id: number;
  nom: string;
  code: string;
}