import { API_URL, apiFetch } from "../../../config/api";
import type {
  ArticleRecette,
  Recette,
  RecetteInput,
  SuggestionEconomie,
  UniteRecette,
} from "../types/recette";

export async function getRecettes(): Promise<Recette[]> {
  const response = await apiFetch(`${API_URL}/recettes`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les recettes");
  }

  return response.json();
}

export async function creerRecette(
  input: RecetteInput & { societeId: number }
): Promise<Recette> {
  const response = await apiFetch(`${API_URL}/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de créer la recette");
  }

  return response.json();
}

export async function modifierRecette(id: number, input: RecetteInput): Promise<Recette> {
  const response = await apiFetch(`${API_URL}/recettes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de modifier la recette");
  }

  return response.json();
}

export async function supprimerRecette(id: number): Promise<void> {
  const response = await apiFetch(`${API_URL}/recettes/${id}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error("Impossible de supprimer la recette");
  }
}

export async function getArticlesDisponibles(): Promise<ArticleRecette[]> {
  const response = await apiFetch(`${API_URL}/articles`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les articles");
  }

  return response.json();
}

export async function getSuggestionsEconomie(recetteId: number): Promise<SuggestionEconomie[]> {
  const response = await apiFetch(`${API_URL}/recettes/${recetteId}/suggestions-economie`);

  if (!response.ok) {
    throw new Error("Impossible de calculer les suggestions d'économies");
  }

  return response.json();
}

export async function getUnitesDisponibles(): Promise<UniteRecette[]> {
  const response = await apiFetch(`${API_URL}/unites`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les unités");
  }

  return response.json();
}
