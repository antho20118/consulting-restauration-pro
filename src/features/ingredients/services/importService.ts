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
  // Confirmation explicite d'une correspondance approximative (voir PropositionLigneImport,
  // statut "tarif_a_remplacer" + typeCorrespondance "approximative") : doit être exactement
  // l'articleId de la proposition présentée à l'utilisateur en prévisualisation, jamais un simple
  // booléen — le serveur réévalue la correspondance au moment de l'écriture et compare (voir
  // POST /articles/import, PR #79). Sans cette confirmation (ou si elle ne correspond plus à la
  // proposition réévaluée), la ligne n'est jamais écrite.
  confirmationArticleId?: number;
};

// Miroir exact du type serveur (server/utils/importListing.ts, PropositionLigneImport) : une
// prévisualisation, jamais une écriture. Dupliqué délibérément côté client plutôt que partagé,
// même principe que le reste du projet entre client et serveur (aucun module TypeScript commun).
export type PropositionLigneImport =
  | { statut: "invalide"; designation: string; reference: string | null; motif: string }
  | {
      statut: "creation";
      designation: string;
      reference: string | null;
      fournisseurNom: string;
      prixHT: number;
      uniteId: number;
      uniteSymbole: string;
    }
  | {
      statut: "tarif_inchange";
      designation: string;
      reference: string | null;
      articleId: number;
      articleNom: string;
      typeCorrespondance: "reference" | "approximative";
      score: number | null;
    }
  | {
      statut: "tarif_a_remplacer";
      designation: string;
      reference: string | null;
      articleId: number;
      articleNom: string;
      typeCorrespondance: "reference" | "approximative";
      score: number | null;
      ancienPrixHT: number | null;
      nouveauPrixHT: number;
      fournisseurNom: string;
      uniteId: number;
      uniteSymbole: string;
    };

export type ResultatImport = {
  crees: number;
  misesAJour: number;
  inchanges: number;
  // Ligne à correspondance approximative jamais écrite faute de confirmation valide (voir
  // confirmationArticleId ci-dessus) — distincte des erreurs (ligne illisible/invalide).
  enAttente: number;
  erreurs: string[];
};

export async function apercuListing(payload: {
  societeId: number;
  fournisseurNom: string;
  lignes: LigneImport[];
}): Promise<{ propositions: PropositionLigneImport[] }> {
  const response = await apiFetch(`${API_URL}/articles/import/apercu`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Impossible d'analyser le listing");
  }

  return response.json();
}

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
