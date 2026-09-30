import { API_URL, apiFetch } from "../../../config/api";

export type QuestionCatalogue = {
  cle: string;
  question: string;
};

export type ReponseQuestion = {
  cle: string;
  question: string;
  reponse: string;
  details?: unknown;
};

export async function getCatalogueQuestions(): Promise<QuestionCatalogue[]> {
  const response = await apiFetch(`${API_URL}/questions`);
  if (!response.ok) throw new Error("Impossible de récupérer le catalogue de questions");
  return response.json();
}

export async function getReponseQuestion(cle: string): Promise<ReponseQuestion> {
  const response = await apiFetch(`${API_URL}/questions/${encodeURIComponent(cle)}`);
  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible de calculer la réponse à cette question");
  }
  return response.json();
}
