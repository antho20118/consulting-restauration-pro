import { API_URL, apiFetch } from "../../../config/api";

export type LigneImport = {
  designation: string;
  prix: string;
  conditionnement?: string;
  reference?: string;
  allergenes?: string;
  categorie?: string;
  // Fournisseur propre à cette ligne (fichier combinant plusieurs fournisseurs) : prime sur le
  // fournisseur unique du payload quand renseigné.
  fournisseur?: string;
};

export type ResultatImport = {
  crees: number;
  misesAJour: number;
  inchanges: number;
  erreurs: string[];
};

export async function importerListing(payload: {
  societeId: number;
  fournisseurNom: string;
  categorieId: number;
  tvaId: number;
  type: string;
  lignes: LigneImport[];
}): Promise<ResultatImport> {
  const response = await apiFetch(`${API_URL}/articles/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Impossible d'importer le listing");
  }

  return response.json();
}
