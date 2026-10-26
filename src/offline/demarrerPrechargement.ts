import { API_URL, apiFetch, EVENEMENT_COMPTE_MODIFIE, getUtilisateur } from "../config/api";
import { CACHE_LECTURES_HORS_LIGNE } from "./nomCache";
import {
  prechargementNecessaire,
  prechargerLectures,
  type BilanPrechargement,
  type DernierPrechargement,
} from "./prechargementLectures";

// Émis une fois le préchargement terminé, avec son bilan — utile à toute page (ou à un test de bout
// en bout) qui voudrait savoir quand les fiches sont lisibles hors connexion.
export const EVENEMENT_LECTURES_PRECHARGEES = "lectures-hors-ligne-prechargees";

const ATTENTE_SERVICE_WORKER_MS = 15_000;
const CLE_DERNIER_PRECHARGEMENT = "dernierPrechargementLectures";

// localStorage peut être indisponible (navigation privée) : on préchargerait alors à chaque
// ouverture, comme si rien n'avait été mémorisé — jamais une erreur.
function lireDernier(): DernierPrechargement | null {
  try {
    const brut = localStorage.getItem(CLE_DERNIER_PRECHARGEMENT);
    return brut ? (JSON.parse(brut) as DernierPrechargement) : null;
  } catch {
    return null;
  }
}

function memoriserDernier(dernier: DernierPrechargement | null): void {
  try {
    if (dernier) localStorage.setItem(CLE_DERNIER_PRECHARGEMENT, JSON.stringify(dernier));
    else localStorage.removeItem(CLE_DERNIER_PRECHARGEMENT);
  } catch {
    // Sans mémoire, le prochain lancement préchargera simplement à nouveau.
  }
}

let dejaLance = false;

// Le cache n'est rempli que par des requêtes passant par le service worker : au tout premier
// lancement, il s'installe mais ne contrôle pas encore la page — on attend qu'il en prenne le
// contrôle (clientsClaim, voir vite.config.ts), sans jamais bloquer au-delà d'un délai raisonnable.
async function serviceWorkerActif(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  if (navigator.serviceWorker.controller) return true;
  return new Promise((resolve) => {
    const delai = setTimeout(() => resolve(false), ATTENTE_SERVICE_WORKER_MS);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      clearTimeout(delai);
      resolve(true);
    }, { once: true });
  });
}

// À appeler une fois connecté (voir App.tsx) : précharge en arrière-plan toutes les fiches
// recettes, menus et productions pour qu'elles restent lisibles sans réseau (voir
// prechargementLectures.ts). Au plus une fois toutes les 12 heures par compte (voir
// prechargementNecessaire) ; sans effet hors ligne ou sans service worker (navigateur non
// compatible, mode développement).
export async function demarrerPrechargementLectures(): Promise<BilanPrechargement | null> {
  const utilisateur = getUtilisateur();
  if (dejaLance || !navigator.onLine || !utilisateur) return null;
  if (!prechargementNecessaire(lireDernier(), utilisateur.id, Date.now())) return null;
  dejaLance = true;
  if (!(await serviceWorkerActif())) {
    dejaLance = false;
    return null;
  }
  const bilan = await prechargerLectures(async (chemin) => {
    const reponse = await apiFetch(`${API_URL}${chemin}`);
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    return reponse.json();
  });
  // Mémorisé seulement si tout est passé : une fiche manquée sera retentée au prochain lancement.
  if (bilan.echecs === 0) memoriserDernier({ le: Date.now(), utilisateurId: utilisateur.id });
  window.dispatchEvent(new CustomEvent(EVENEMENT_LECTURES_PRECHARGEES, { detail: bilan }));
  return bilan;
}

// Déconnexion : le prochain compte connecté sur cet appareil relancera son propre préchargement
// (le cache du précédent est purgé, voir enregistrerPwa.ts).
window.addEventListener("auth:logout", () => {
  dejaLance = false;
  memoriserDernier(null);
});

// Rôle changé depuis la connexion (voir src/features/auth/services/session.ts) : les fiches gardées
// sur l'appareil ont été chargées avec l'ancien rôle — un CHEF devenu CUISINIER y retrouverait, hors
// connexion, les prix qu'il ne doit plus voir. Purgées, puis rechargées avec le nouveau rôle.
window.addEventListener(EVENEMENT_COMPTE_MODIFIE, () => {
  memoriserDernier(null);
  const purge = typeof caches === "undefined" ? Promise.resolve(false) : caches.delete(CACHE_LECTURES_HORS_LIGNE);
  purge
    .catch(() => false)
    .then(() => {
      dejaLance = false;
      return demarrerPrechargementLectures();
    })
    .catch(() => {});
});
