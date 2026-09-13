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
      symbole: string;
    };
  }[];

  stocks?: {
    quantite: number;
  }[];
}