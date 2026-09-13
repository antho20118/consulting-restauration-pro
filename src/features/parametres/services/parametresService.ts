import { API_URL } from "../../../config/api";
import type { Categorie, Societe, Tva, TvaInput, Unite, UniteInput } from "../types/parametres";

async function verifierReponse(response: Response, messageErreur: string) {
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error ?? messageErreur);
  }
}

export async function getCategories(): Promise<Categorie[]> {
  const response = await fetch(`${API_URL}/categories`);
  await verifierReponse(response, "Impossible de récupérer les catégories");
  return response.json();
}

export async function creerCategorie(nom: string): Promise<Categorie> {
  const response = await fetch(`${API_URL}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nom }),
  });
  await verifierReponse(response, "Impossible de créer la catégorie");
  return response.json();
}

export async function modifierCategorie(id: number, nom: string): Promise<Categorie> {
  const response = await fetch(`${API_URL}/categories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nom }),
  });
  await verifierReponse(response, "Impossible de modifier la catégorie");
  return response.json();
}

export async function supprimerCategorie(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/categories/${id}`, { method: "DELETE" });
  await verifierReponse(response, "Impossible de supprimer la catégorie");
}

export async function getUnites(): Promise<Unite[]> {
  const response = await fetch(`${API_URL}/unites`);
  await verifierReponse(response, "Impossible de récupérer les unités");
  return response.json();
}

export async function creerUnite(input: UniteInput): Promise<Unite> {
  const response = await fetch(`${API_URL}/unites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await verifierReponse(response, "Impossible de créer l'unité");
  return response.json();
}

export async function modifierUnite(id: number, input: UniteInput): Promise<Unite> {
  const response = await fetch(`${API_URL}/unites/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await verifierReponse(response, "Impossible de modifier l'unité");
  return response.json();
}

export async function supprimerUnite(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/unites/${id}`, { method: "DELETE" });
  await verifierReponse(response, "Impossible de supprimer l'unité");
}

export async function getSociete(): Promise<Societe> {
  const response = await fetch(`${API_URL}/societe`);
  await verifierReponse(response, "Impossible de récupérer la société");
  return response.json();
}

export async function modifierSociete(id: number, nom: string): Promise<Societe> {
  const response = await fetch(`${API_URL}/societe/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nom }),
  });
  await verifierReponse(response, "Impossible de modifier la société");
  return response.json();
}

export async function getTva(): Promise<Tva[]> {
  const response = await fetch(`${API_URL}/tva`);
  await verifierReponse(response, "Impossible de récupérer les taux de TVA");
  return response.json();
}

export async function creerTva(input: TvaInput): Promise<Tva> {
  const response = await fetch(`${API_URL}/tva`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await verifierReponse(response, "Impossible de créer la TVA");
  return response.json();
}

export async function modifierTva(id: number, input: TvaInput): Promise<Tva> {
  const response = await fetch(`${API_URL}/tva/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await verifierReponse(response, "Impossible de modifier la TVA");
  return response.json();
}

export async function supprimerTva(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/tva/${id}`, { method: "DELETE" });
  await verifierReponse(response, "Impossible de supprimer la TVA");
}
