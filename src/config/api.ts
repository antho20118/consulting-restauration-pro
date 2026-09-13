// Préfixé par /api pour ne jamais entrer en collision avec les routes du frontend
// (ex. /recettes est à la fois une page React et, sans préfixe, une route API).
export const API_URL = `${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/api`;

const CLE_TOKEN = "consulting_token";

export function getToken(): string | null {
  return localStorage.getItem(CLE_TOKEN);
}

export function setToken(token: string): void {
  localStorage.setItem(CLE_TOKEN, token);
}

export function clearToken(): void {
  localStorage.removeItem(CLE_TOKEN);
}

// Prévient le reste de l'appli (événement "auth:logout") pour revenir à l'écran de connexion,
// que ce soit un clic sur "Déconnexion" ou un jeton rejeté par le serveur.
export function seDeconnecter(): void {
  clearToken();
  window.dispatchEvent(new Event("auth:logout"));
}

// Ajoute automatiquement le jeton d'authentification aux appels à l'API, et déclenche la
// déconnexion si le serveur répond 401 (jeton absent, invalide ou expiré) — pour revenir à l'écran
// de connexion sans avoir à vérifier le jeton avant chaque appel.
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const reponse = await fetch(input, { ...init, headers });

  if (reponse.status === 401) {
    seDeconnecter();
  }

  return reponse;
}
