import { API_URL, apiFetch } from "../../../config/api";

// Miroir client des types serveur (voir server/routes/listingsFournisseur.ts, server/utils/
// rapprochementFournisseur.ts) — même principe que importService.ts : dupliqué délibérément entre
// client et serveur, jamais de module TypeScript partagé dans ce projet.

export class ImportIANonConfigureeError extends Error {}

export async function extraireListingParPhoto(photoDataUrl: string): Promise<{ lignes: LigneListingExtraite[] }> {
  const response = await apiFetch(`${API_URL}/listings-fournisseur/import-ia`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoDataUrl }),
  });

  if (response.status === 503) {
    throw new ImportIANonConfigureeError();
  }
  if (!response.ok) {
    throw new Error("Impossible d'analyser cette photo de listing");
  }

  return response.json();
}

export type LigneListingExtraite = {
  designation: string;
  reference: string | null;
  prix: string | null;
  conditionnement: string | null;
};

export type NatureLigne = "ARTICLE" | "FRAIS_LIVRAISON" | "AVOIR" | "NON_ALIMENTAIRE" | "REMISE";
export type MotifCorrespondance =
  | "REFERENCE_FOURNISSEUR"
  | "CODE_ARTICLE"
  | "ALIAS"
  | "DESIGNATION_EXACTE"
  | "DESIGNATION_APPROXIMATIVE";

export type CandidatAlternatif = { articleId: number; nom: string; score: number };

export type LigneDocumentFournisseur = {
  id: number;
  documentId: number;
  designationLue: string;
  referenceLue: string | null;
  quantiteLue: number | null;
  uniteLue: string | null;
  conditionnementLu: string | null;
  prixLu: number | null;
  natureLigne: NatureLigne;
  articleProposeId: number | null;
  confiance: number | null;
  motifCorrespondance: MotifCorrespondance | null;
  candidatsAlternatifs: CandidatAlternatif[] | null;
  decision: "EN_ATTENTE" | "VALIDEE" | "REJETEE";
  articleRetenuId: number | null;
  tarifCreeId: number | null;
};

export type DocumentFournisseur = {
  id: number;
  fournisseurId: number;
  type: "LISTING" | "FACTURE";
  statut: "EN_ATTENTE" | "VALIDE" | "IGNORE";
  cle: string;
  typeMime: string;
  tailleOctets: number;
  nomFichierOriginal: string | null;
};

export async function creerListingPhoto(params: {
  fournisseurId: number;
  societeId: number;
  photoDataUrl: string;
  nomFichierOriginal?: string;
  lignes: LigneListingExtraite[];
}): Promise<{ document: DocumentFournisseur; lignes: LigneDocumentFournisseur[] }> {
  const { fournisseurId, ...corps } = params;
  const response = await apiFetch(`${API_URL}/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });

  if (!response.ok) {
    const donnees = await response.json().catch(() => null);
    throw new Error(donnees?.error ?? "Impossible d'importer ce listing");
  }

  return response.json();
}

// Détail d'un document déjà importé (onglet "Listings" de la fiche fournisseur, Phase 5) : mêmes
// champs niveau A/B/C que LigneDocumentFournisseur, enrichis du nom des articles proposé/retenu
// (jamais confondus l'un avec l'autre, voir cadrage §8) pour un affichage direct sans requête
// supplémentaire côté client.
export type LigneDocumentFournisseurDetail = LigneDocumentFournisseur & {
  articlePropose: { id: number; nom: string } | null;
  articleRetenu: { id: number; nom: string } | null;
};

export type DocumentFournisseurDetail = DocumentFournisseur & {
  numero: string | null;
  dateDocument: string | null;
  montantTotal: number | null;
  importeLe: string;
  lignes: LigneDocumentFournisseurDetail[];
};

export async function getDocumentDetail(documentId: number): Promise<DocumentFournisseurDetail> {
  const response = await apiFetch(`${API_URL}/listings-fournisseur/documents/${documentId}`);

  if (response.status === 404) {
    throw new Error("Document introuvable");
  }
  if (!response.ok) {
    throw new Error("Impossible de récupérer ce document");
  }

  return response.json();
}

export type DecisionLigne = { ligneId: number; decision: "VALIDEE" | "REJETEE"; articleRetenuId?: number };

export async function validerListingPhoto(
  documentId: number,
  decisions: DecisionLigne[]
): Promise<{ valides: number; rejetees: number; refusees: string[] }> {
  const response = await apiFetch(`${API_URL}/listings-fournisseur/documents/${documentId}/valider`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisions }),
  });

  if (!response.ok) {
    throw new Error("Impossible d'appliquer les décisions");
  }

  return response.json();
}
