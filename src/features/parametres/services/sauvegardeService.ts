import { API_URL, apiFetch } from "../../../config/api";

export type Sauvegarde = {
  nom: string;
  tailleOctets: number;
  creeLe: string;
};

export async function getSauvegardes(): Promise<Sauvegarde[]> {
  const response = await apiFetch(`${API_URL}/sauvegardes`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer la liste des sauvegardes");
  }

  return response.json();
}

// Le fichier exige un jeton d'authentification (voir apiFetch) : jamais un lien direct vers
// GET /api/sauvegardes/:nom, qui échouerait en 401 hors d'un appel fetch authentifié — le blob est
// récupéré ici puis livré au navigateur via un <a download> temporaire, seul moyen de déclencher un
// vrai téléchargement (plutôt qu'un affichage) à partir d'un blob local.
export async function telechargerSauvegarde(nom: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/sauvegardes/${nom}`);

  if (!response.ok) {
    throw new Error("Impossible de télécharger cette sauvegarde");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}
