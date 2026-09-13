import { API_URL, apiFetch } from "../../../config/api";
import type { MouvementInput, MouvementStock } from "../types/mouvement";

export async function getMouvements(): Promise<MouvementStock[]> {
  const response = await apiFetch(`${API_URL}/mouvements`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les mouvements de stock");
  }

  return response.json();
}

export async function creerMouvement(input: MouvementInput): Promise<MouvementStock> {
  const response = await apiFetch(`${API_URL}/mouvements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error ?? "Impossible d'enregistrer le mouvement");
  }

  return response.json();
}
