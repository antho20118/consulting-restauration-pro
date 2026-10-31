import { API_URL, apiFetch } from "../../../config/api";
import { telechargerFichier } from "../../../common/telechargerFichier";

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

  telechargerFichier(nom, await response.blob());
}

// État de la sauvegarde automatique hors de Railway (voir server/utils/sauvegardeExterne/).
export type EtatSauvegardeExterne = {
  configuration: "absente" | "incomplete" | "ok";
  probleme: string | null;
  enCours: boolean;
  derniereConnue: boolean;
  derniereReussie: { le: string; nom: string } | null;
  dernierEchec: { le: string; message: string } | null;
};

export async function getEtatSauvegardeExterne(): Promise<EtatSauvegardeExterne> {
  const response = await apiFetch(`${API_URL}/sauvegardes/externe`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer l'état de la sauvegarde externe");
  }

  return response.json();
}
