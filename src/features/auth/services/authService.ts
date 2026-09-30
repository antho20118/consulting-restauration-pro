import { API_URL, apiFetch, setToken, setUtilisateur } from "../../../config/api";

// Utilise fetch (pas apiFetch) : la connexion n'a pas encore de jeton, et un échec ici ne doit pas
// déclencher l'événement "auth:logout" (on est déjà sur l'écran de connexion).
export async function seConnecter(identifiant: string, code: string): Promise<void> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error ?? "Identifiant ou code incorrect");
  }

  setToken(data.token);
  setUtilisateur(data.utilisateur);
}

// Modifie SON PROPRE compte (identifiant + code) — voir server/routes/utilisateurs.ts pour la
// gestion d'un autre compte par un PROPRIETAIRE.
export async function modifierMonCompte(
  codeActuel: string,
  nouvelIdentifiant: string,
  nouveauCode: string
): Promise<void> {
  const response = await apiFetch(`${API_URL}/auth/moi`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codeActuel, nouvelIdentifiant, nouveauCode }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error ?? "Impossible de modifier le compte");
  }

  // Le jeton précédent porte l'ancien identifiant : on le remplace pour rester connecté.
  setToken(data.token);
}
