import { API_URL, apiFetch } from "../../../config/api";
import type { BesoinAchat, CibleProduction, PlanificationProduction, PropositionAchat } from "../types/production";

export async function planifierProduction(
  recetteId: number,
  cible: CibleProduction,
  depotId?: number
): Promise<PlanificationProduction> {
  const response = await apiFetch(`${API_URL}/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recetteId, cible, depotId }),
  });

  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible de planifier la production");
  }

  return response.json();
}

export async function proposerAchat(besoins: BesoinAchat[], depotId?: number): Promise<PropositionAchat> {
  const response = await apiFetch(`${API_URL}/achats/proposition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ besoins, depotId }),
  });

  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible de générer la proposition d'achat");
  }

  return response.json();
}
