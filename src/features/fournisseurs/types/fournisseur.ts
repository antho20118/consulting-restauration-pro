export interface Fournisseur {
  id: number;
  nom: string;
  telephone: string | null;
  email: string | null;
  siteWeb: string | null;
  _count?: {
    tarifs: number;
  };
}

export type FournisseurInput = {
  nom: string;
  telephone: string;
  email: string;
  siteWeb: string;
};
