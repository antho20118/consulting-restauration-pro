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
  // Identité stable (voir cadrage « identité fournisseur + produit fournisseur ») : quand fournis,
  // priment toujours sur fournisseur/reference ci-dessus pour résoudre le fournisseur et retrouver
  // le produit déjà connu chez lui — jamais de recherche par nom/référence catalogue devant cette
  // identité. Optionnels : un fichier sans ces colonnes continue de fonctionner comme avant.
  codeFournisseur?: string;
  codeProduitFournisseur?: string;
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
    }
  // Ajouté par le chantier « identité fournisseur + historique des imports » : le nom de
  // fournisseur de cette ligne correspond, après normalisation, à PLUSIEURS fournisseurs déjà
  // existants — jamais un choix arbitraire, ni en aperçu ni à l'écriture. Cette ligne ne peut pas
  // être importée tant que l'ambiguïté n'est pas résolue manuellement (fiches fournisseurs).
  | {
      statut: "fournisseur_ambigu";
      designation: string;
      reference: string | null;
      nom: string;
      fournisseurIds: number[];
    }
  // Ajoutés par le chantier « identité fournisseur + produit fournisseur + historique des tarifs » :
  // un fournisseur retrouvé (par code ou par nom) est actif:false — jamais réutilisé silencieusement,
  // ni en aperçu ni à l'écriture.
  | {
      statut: "fournisseur_inactif";
      designation: string;
      reference: string | null;
      identifiant: string;
      fournisseurId: number;
    }
  // Un code produit fournisseur déjà connu chez ce fournisseur porte une désignation très
  // différente de celle lue dans cette ligne — jamais un écrasement silencieux, décision humaine
  // requise avant d'importer cette ligne.
  | {
      statut: "code_produit_designation_differente";
      designation: string;
      reference: string | null;
      codeProduitFournisseur: string;
      designationConnue: string;
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
  // Identité stable par défaut du fichier (voir cadrage) : optionnel, prime sur fournisseurNom
  // quand fourni. Un code inconnu ou inactif fait échouer tout l'import (409) plutôt que de créer
  // silencieusement un fournisseur.
  codeFournisseur?: string;
  categorieId: number;
  tvaId: number;
  type: string;
  lignes: LigneImport[];
  // Métadonnées du fichier source, jamais inventées : reprises telles quelles du File choisi par
  // l'utilisateur (voir Phase 6, historique des imports Excel via DocumentFournisseur).
  nomFichierOriginal?: string;
  typeMime?: string;
  tailleOctets?: number;
}): Promise<ResultatImport> {
  const response = await apiFetch(`${API_URL}/articles/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    // Une ambiguïté fournisseur (409) porte un message explicite et exploitable par
    // l'utilisateur — jamais remplacé par un message générique quand il est disponible.
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible d'importer le listing");
  }

  return response.json();
}
