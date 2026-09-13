import { API_URL, apiFetch } from "../../../config/api";
import type { Depot, DepotInput } from "../types/depot";

export async function getDepots(): Promise<Depot[]> {
  const response = await apiFetch(`${API_URL}/depots`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les dépôts");
  }

  return response.json();
}

export async function creerDepot(input: DepotInput & { societeId: number }): Promise<Depot> {
  const response = await apiFetch(`${API_URL}/depots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de créer le dépôt");
  }

  return response.json();
}

export async function modifierDepot(id: number, input: DepotInput): Promise<Depot> {
  const response = await apiFetch(`${API_URL}/depots/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de modifier le dépôt");
  }

  return response.json();
}

export async function supprimerDepot(id: number): Promise<void> {
  const response = await apiFetch(`${API_URL}/depots/${id}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error("Impossible de supprimer le dépôt");
  }
}
