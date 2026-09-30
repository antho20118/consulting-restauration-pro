import { API_URL, apiFetch } from "../../../config/api";
import {
  ImportIANonConfigureeError,
  type LigneListingExtraite,
  type LigneDocumentFournisseur,
  type DocumentFournisseur,
} from "../../ingredients/services/listingFournisseurService";

// Miroir client de POST /listings-fournisseur/factures/* (server/routes/listingsFournisseur.ts,
// Phase 6) — même principe de duplication délibérée que listingFournisseurService.ts. Réexporte
// ImportIANonConfigureeError plutôt que d'en redéfinir une seconde : une seule classe d'erreur pour
// les deux imports par photo (listing et facture) côté client.
export { ImportIANonConfigureeError };

export type FactureExtraite = {
  numero: string | null;
  dateDocument: string | null;
  montantTotal: number | null;
  lignes: LigneListingExtraite[];
};

export async function extraireFactureParPhoto(photoDataUrl: string): Promise<FactureExtraite> {
  const response = await apiFetch(`${API_URL}/listings-fournisseur/factures/import-ia`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoDataUrl }),
  });

  if (response.status === 503) {
    throw new ImportIANonConfigureeError();
  }
  if (!response.ok) {
    throw new Error("Impossible d'analyser cette photo de facture");
  }

  return response.json();
}

export type NiveauDoublon = "FORTE" | "FAIBLE";

export type CorrespondanceDoublon = {
  documentId: number;
  numero: string | null;
  dateDocument: string | null;
  montantTotal: number | null;
  importeLe: string;
  niveau: NiveauDoublon;
};

export type AlerteDoublon = { niveau: NiveauDoublon; correspondances: CorrespondanceDoublon[] };

// La route renvoie soit une alerte de doublon purement informative (rien n'est stocké/créé côté
// serveur), soit le document réellement importé — jamais les deux à la fois. Distingués ici par la
// présence du champ "doublon", jamais par le code HTTP (les deux réponses sont un 200/201 valide).
export type ResultatImportFacture =
  | { doublon: AlerteDoublon; document?: undefined }
  | { document: DocumentFournisseur; lignes: LigneDocumentFournisseur[]; doublon?: undefined };

export async function creerFacturePhoto(params: {
  fournisseurId: number;
  photoDataUrl: string;
  nomFichierOriginal?: string;
  lignes: LigneListingExtraite[];
  numero: string | null;
  dateDocument: string | null;
  montantTotal: number | null;
  confirmerDoublon?: boolean;
}): Promise<ResultatImportFacture> {
  const { fournisseurId, ...corps } = params;
  const response = await apiFetch(`${API_URL}/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });

  if (!response.ok) {
    const donnees = await response.json().catch(() => null);
    throw new Error(donnees?.error ?? "Impossible d'importer cette facture");
  }

  return response.json();
}
