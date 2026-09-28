import { API_URL, apiFetch } from "../../../config/api";
import type { RegleHACCP } from "../types/haccp";

export async function getReglesHACCP(): Promise<RegleHACCP[]> {
  const response = await apiFetch(`${API_URL}/haccp/regles`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer la bibliothèque de règles HACCP");
  }

  return response.json();
}
