import { API_URL, apiFetch } from "../../../config/api";
import type { Fournisseur, FournisseurInput } from "../types/fournisseur";

export async function getFournisseurs(options?: { inclureInactifs?: boolean }): Promise<Fournisseur[]> {
  const suffixe = options?.inclureInactifs ? "?inclureInactifs=true" : "";
  const response = await apiFetch(`${API_URL}/fournisseurs${suffixe}`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les fournisseurs");
  }

  return response.json();
}

export async function getFournisseur(id: number): Promise<Fournisseur> {
  const response = await apiFetch(`${API_URL}/fournisseurs/${id}`);

  if (response.status === 404) {
    throw new Error("Fournisseur introuvable");
  }
  if (!response.ok) {
    throw new Error("Impossible de récupérer ce fournisseur");
  }

  return response.json();
}

export type TarifFournisseur = {
  id: number;
  articleId: number;
  prixHT: number;
  quantiteConditionnement: number;
  dateDebut: string;
  dateFin: string | null;
  actif: boolean;
  article: { id: number; nom: string; reference: string | null };
  unite: { symbole: string };
  conditionnement: { nom: string };
  ligneDocumentSource: {
    id: number;
    designationLue: string;
    document: {
      id: number;
      type: "LISTING" | "FACTURE";
      cle: string;
      importeLe: string;
      nomFichierOriginal: string | null;
    };
  } | null;
};

export async function getTarifsFournisseur(id: number): Promise<TarifFournisseur[]> {
  const response = await apiFetch(`${API_URL}/fournisseurs/${id}/tarifs`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les tarifs de ce fournisseur");
  }

  return response.json();
}

export type DocumentFournisseurResume = {
  id: number;
  type: "LISTING" | "FACTURE";
  statut: "EN_ATTENTE" | "VALIDE" | "IGNORE";
  cle: string;
  typeMime: string;
  tailleOctets: number;
  nomFichierOriginal: string | null;
  numero: string | null;
  dateDocument: string | null;
  montantTotal: number | null;
  importeLe: string;
  _count: { lignes: number };
};

export async function getDocumentsFournisseur(id: number): Promise<DocumentFournisseurResume[]> {
  const response = await apiFetch(`${API_URL}/fournisseurs/${id}/documents`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les documents de ce fournisseur");
  }

  return response.json();
}

export async function creerFournisseur(input: FournisseurInput): Promise<Fournisseur> {
  const response = await apiFetch(`${API_URL}/fournisseurs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de créer le fournisseur");
  }

  return response.json();
}

export async function modifierFournisseur(
  id: number,
  input: FournisseurInput
): Promise<Fournisseur> {
  const response = await apiFetch(`${API_URL}/fournisseurs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de modifier le fournisseur");
  }

  return response.json();
}

export async function supprimerFournisseur(id: number): Promise<void> {
  const response = await apiFetch(`${API_URL}/fournisseurs/${id}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error("Impossible de supprimer le fournisseur");
  }
}

// Réactivation explicite d'un fournisseur désactivé (POST /:id/reactiver, distinct de PUT /:id) —
// jamais automatique côté serveur (voir server/routes/fournisseurs.ts), donc jamais implicite ici
// non plus.
export async function reactiverFournisseur(id: number): Promise<Fournisseur> {
  const response = await apiFetch(`${API_URL}/fournisseurs/${id}/reactiver`, { method: "POST" });

  if (!response.ok) {
    throw new Error("Impossible de réactiver le fournisseur");
  }

  return response.json();
}
