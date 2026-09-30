import { API_URL, apiFetch } from "../../../config/api";

export type EntreeJournalErreur = {
  id: number;
  origine: "SERVEUR" | "CLIENT";
  moment: string;
  methode: string | null;
  route: string | null;
  statutHttp: number | null;
  message: string;
  pile: string | null;
  userAgent: string | null;
  societeId: number | null;
  utilisateurId: number | null;
};

export async function getJournalErreurs(): Promise<EntreeJournalErreur[]> {
  const response = await apiFetch(`${API_URL}/journal-erreurs`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer le journal des erreurs");
  }

  return response.json();
}
