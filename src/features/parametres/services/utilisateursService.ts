import { API_URL, apiFetch, type RoleUtilisateur } from "../../../config/api";

export type Utilisateur = {
  id: number;
  identifiant: string;
  role: RoleUtilisateur;
  actif: boolean;
  createdAt: string;
};

export async function getUtilisateurs(): Promise<Utilisateur[]> {
  const response = await apiFetch(`${API_URL}/utilisateurs`);
  if (!response.ok) throw new Error("Impossible de récupérer les comptes");
  return response.json();
}

export async function creerUtilisateur(
  identifiant: string,
  code: string,
  role: RoleUtilisateur
): Promise<Utilisateur> {
  const response = await apiFetch(`${API_URL}/utilisateurs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code, role }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Impossible de créer le compte");
  return data;
}

export async function modifierUtilisateur(
  id: number,
  changements: { role?: RoleUtilisateur; actif?: boolean }
): Promise<Utilisateur> {
  const response = await apiFetch(`${API_URL}/utilisateurs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changements),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Impossible de modifier le compte");
  return data;
}

export async function reinitialiserCode(id: number, nouveauCode: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/utilisateurs/${id}/reinitialiser-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nouveauCode }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? "Impossible de réinitialiser le code");
  }
}
