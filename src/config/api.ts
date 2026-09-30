// Préfixé par /api pour ne jamais entrer en collision avec les routes du frontend
// (ex. /recettes est à la fois une page React et, sans préfixe, une route API).
export const API_URL = `${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/api`;

const CLE_TOKEN = "consulting_token";
const CLE_UTILISATEUR = "consulting_utilisateur";

export function getToken(): string | null {
  return localStorage.getItem(CLE_TOKEN);
}

export function setToken(token: string): void {
  localStorage.setItem(CLE_TOKEN, token);
}

export function clearToken(): void {
  localStorage.removeItem(CLE_TOKEN);
}

// Un compte par personne (voir Utilisateur, prisma/schema.prisma) : le rôle sert uniquement à
// adapter l'affichage (masquer la gestion des comptes à qui n'est pas PROPRIETAIRE, par exemple) —
// jamais une source de vérité pour l'autorisation, toujours revérifiée côté serveur.
export type RoleUtilisateur = "PROPRIETAIRE" | "CHEF" | "CUISINIER" | "CONSULTANT";
export type UtilisateurConnecte = {
  id: number;
  identifiant: string;
  role: RoleUtilisateur;
  societeId: number;
};

export function getUtilisateur(): UtilisateurConnecte | null {
  const brut = localStorage.getItem(CLE_UTILISATEUR);
  if (!brut) return null;
  try {
    return JSON.parse(brut) as UtilisateurConnecte;
  } catch {
    return null;
  }
}

export function setUtilisateur(utilisateur: UtilisateurConnecte): void {
  localStorage.setItem(CLE_UTILISATEUR, JSON.stringify(utilisateur));
}

// Prévient le reste de l'appli (événement "auth:logout") pour revenir à l'écran de connexion,
// que ce soit un clic sur "Déconnexion" ou un jeton rejeté par le serveur.
export function seDeconnecter(): void {
  clearToken();
  localStorage.removeItem(CLE_UTILISATEUR);
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
