import { API_URL, apiFetch } from "../../../config/api";
import type { BesoinAchat, Commande } from "../types/commande";

export async function creerCommandes(besoins: BesoinAchat[], depotId: number): Promise<Commande[]> {
  const response = await apiFetch(`${API_URL}/commandes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ depotId, besoins }),
  });
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible d'enregistrer la commande");
  }
  const { commandes } = await response.json();
  return commandes;
}

export async function getCommandes(): Promise<Commande[]> {
  const response = await apiFetch(`${API_URL}/commandes`);
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible de récupérer les commandes");
  }
  return response.json();
}

export async function getCommande(id: number): Promise<Commande> {
  const response = await apiFetch(`${API_URL}/commandes/${id}`);
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible de récupérer cette commande");
  }
  return response.json();
}

export async function receptionnerCommande(
  id: number,
  lignes: { ligneId: number; quantiteRecueBase: number }[]
): Promise<Commande> {
  const response = await apiFetch(`${API_URL}/commandes/${id}/receptionner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lignes }),
  });
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible d'enregistrer la réception");
  }
  return response.json();
}

export async function annulerCommande(id: number): Promise<Commande> {
  const response = await apiFetch(`${API_URL}/commandes/${id}/annuler`, { method: "POST" });
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible d'annuler cette commande");
  }
  return response.json();
}
