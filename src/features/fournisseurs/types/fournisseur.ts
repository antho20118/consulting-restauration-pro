export interface Fournisseur {
  id: number;
  // Identité métier stable, générée automatiquement par le serveur — jamais saisie ni modifiable
  // depuis le frontend (voir FournisseurForm.tsx). Nullable : un fournisseur créé avant ce chantier
  // n'en a pas encore (attribution différée, séparée, humaine).
  codeFournisseur?: string | null;
  nom: string;
  telephone: string | null;
  email: string | null;
  siteWeb: string | null;
  actif?: boolean;
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
