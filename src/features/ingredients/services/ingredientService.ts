import { API_URL } from "../../../config/api";
import type { Ingredient } from "../types/ingredient";

export async function getIngredients(): Promise<Ingredient[]> {
  const response = await fetch(`${API_URL}/articles`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les articles");
  }

  return response.json();
}