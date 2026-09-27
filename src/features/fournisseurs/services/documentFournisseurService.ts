import { API_URL, apiFetch } from "../../../config/api";

// Consultation du document original (voir server/routes/documentsFournisseurs.ts, Phase 1) :
// jamais une URL publique ni un <img src> direct (le fichier exige un jeton d'authentification,
// porté par apiFetch) — le blob est récupéré ici puis exposé au composant appelant comme une URL
// d'objet locale au navigateur, jamais un chemin physique du volume.
export async function obtenirUrlDocument(fournisseurId: number, cle: string): Promise<string> {
  const response = await apiFetch(`${API_URL}/documents-fournisseurs/${fournisseurId}/${cle}`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer le document original");
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
