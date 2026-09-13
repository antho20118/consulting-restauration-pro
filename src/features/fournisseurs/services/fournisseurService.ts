import { API_URL, apiFetch } from "../../../config/api";
import type { Fournisseur, FournisseurInput } from "../types/fournisseur";

export async function getFournisseurs(): Promise<Fournisseur[]> {
  const response = await apiFetch(`${API_URL}/fournisseurs`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les fournisseurs");
  }

  return response.json();
}

export async function creerFournisseur(
  input: FournisseurInput & { societeId: number }
): Promise<Fournisseur> {
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
