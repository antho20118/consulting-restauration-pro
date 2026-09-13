import { API_URL } from "../../../config/api";
import type { Ingredient } from "../types/ingredient";

export type IngredientInput = {
  nom: string;
  reference: string;
  categorieId: number;
  rendement: number;
  uniteId: number;
  fournisseurNom: string;
  prixHT: number;
  stockInitial: number;
};

export async function getIngredients(): Promise<Ingredient[]> {
  const response = await fetch(`${API_URL}/articles`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les articles");
  }

  return response.json();
}

export async function creerIngredient(
  input: IngredientInput & { tvaId: number; societeId: number; type: string }
): Promise<Ingredient> {
  const response = await fetch(`${API_URL}/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de créer l'article");
  }

  return response.json();
}

export async function modifierIngredient(id: number, input: IngredientInput): Promise<Ingredient> {
  const response = await fetch(`${API_URL}/articles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de modifier l'article");
  }

  return response.json();
}

export async function supprimerIngredient(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/articles/${id}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error("Impossible de supprimer l'article");
  }
}