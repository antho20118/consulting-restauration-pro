import { API_URL, apiFetch } from "../../../config/api";
import type { Allergene, Ingredient } from "../types/ingredient";

export type IngredientInput = {
  nom: string;
  reference: string;
  categorieId: number;
  rendement: number;
  uniteId: number;
  fournisseurNom: string;
  prixHT: number;
  stockInitial: number;
  allergeneIds: number[];
  // Confirmation explicite qu'un doublon de référence détecté (voir correspondanceArticle.ts)
  // doit bien créer un second article malgré tout — doit correspondre exactement à l'articleId de
  // l'article-doublon réévalué par le serveur au moment de l'écriture (POST /articles), jamais un
  // simple booléen. Absent tant qu'aucun doublon de référence n'a été confirmé.
  confirmationArticleId?: number;
};

export async function getIngredients(): Promise<Ingredient[]> {
  const response = await apiFetch(`${API_URL}/articles`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les articles");
  }

  return response.json();
}

export async function getAllergenes(): Promise<Allergene[]> {
  const response = await apiFetch(`${API_URL}/allergenes`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les allergènes");
  }

  return response.json();
}

export async function creerIngredient(
  input: IngredientInput & { tvaId: number; societeId: number; type: string }
): Promise<Ingredient> {
  const response = await apiFetch(`${API_URL}/articles`, {
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
  const response = await apiFetch(`${API_URL}/articles/${id}`, {
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
  const response = await apiFetch(`${API_URL}/articles/${id}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error("Impossible de supprimer l'article");
  }
}

export type ResultatSuppressionArticles = { supprimes: number; proteges: number };

export async function supprimerTousLesArticles(): Promise<ResultatSuppressionArticles> {
  const response = await apiFetch(`${API_URL}/articles`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error("Impossible de supprimer les articles");
  }

  return response.json();
}