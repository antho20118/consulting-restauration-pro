export type TypeMouvement = "ENTREE" | "SORTIE";

export interface MouvementStock {
  id: number;
  date: string;
  type: TypeMouvement;
  quantite: number;
  motif: string | null;
  article: {
    id: number;
    nom: string;
    uniteBase: string;
  };
  depot: {
    nom: string;
  };
}

export type MouvementInput = {
  articleId: number;
  depotId: number;
  type: TypeMouvement;
  quantite: number;
  motif: string;
};
