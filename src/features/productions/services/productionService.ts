import { API_URL, apiFetch } from "../../../config/api";
import type { CibleProduction } from "../../production/types/production";
import type { Production, ProductionDetail } from "../types/production";

// Clé unique et moment réel d'une saisie faite (ou commencée) hors connexion — voir
// src/offline/actionsProduction.ts et server/routes/productions.ts.
export type SaisieHorsLigne = { cleIdempotence?: string; realiseeLe?: string };

export async function enregistrerProduction(
  recetteId: number,
  cible: CibleProduction,
  depotId?: number,
  saisie: SaisieHorsLigne = {}
): Promise<ProductionDetail> {
  const response = await apiFetch(`${API_URL}/productions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recetteId, cible, depotId, ...saisie }),
  });
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible d'enregistrer la production");
  }
  return response.json();
}

export async function getProductions(): Promise<Production[]> {
  const response = await apiFetch(`${API_URL}/productions`);
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible de récupérer les productions");
  }
  return response.json();
}

export async function getProduction(id: number): Promise<ProductionDetail> {
  const response = await apiFetch(`${API_URL}/productions/${id}`);
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible de récupérer cette production");
  }
  return response.json();
}

export async function ajouterControle(
  productionId: number,
  controle: {
    recetteEtapeId: number;
    valeur: string;
    conforme: boolean;
    commentaire?: string;
    cleIdempotence?: string;
    constateLe?: string;
  }
): Promise<ProductionDetail> {
  const response = await apiFetch(`${API_URL}/productions/${productionId}/controles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(controle),
  });
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible d'enregistrer ce contrôle");
  }
  return response.json();
}
