export interface Depot {
  id: number;
  nom: string;
  description: string | null;
}

export type DepotInput = {
  nom: string;
  description: string;
};
