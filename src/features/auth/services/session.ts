import {
  API_URL,
  apiFetch,
  EVENEMENT_COMPTE_MODIFIE,
  getToken,
  getUtilisateur,
  seDeconnecter,
  setToken,
  setUtilisateur,
  type UtilisateurConnecte,
} from "../../../config/api";

// Renouvellement de la session tant que l'application est utilisée (voir GET /api/auth/session) :
// un jeton expire 12 h après son émission, et un cuisinier connecté le matin était jusqu'ici
// déconnecté d'office en plein service. Le compte renvoyé par le serveur remplace celui mémorisé à
// la connexion : un rôle changé par le PROPRIETAIRE s'applique aux menus sans reconnexion.
//
// Renouvelé à l'ouverture, toutes les 30 minutes, au retour du réseau et quand on revient sur
// l'application (téléphone sorti de veille) — jamais plus d'une fois toutes les 5 minutes. Un
// appareil resté éteint ou hors ligne plus de 12 h demande toujours une reconnexion.
const INTERVALLE_RENOUVELLEMENT_MS = 30 * 60_000;
const ECART_MINIMUM_MS = 5 * 60_000;

let dernierRenouvellement = 0;
let enCours: Promise<void> | null = null;

export function rafraichirSession(): Promise<void> {
  if (enCours) return enCours;
  if (!getToken() || !navigator.onLine || Date.now() - dernierRenouvellement < ECART_MINIMUM_MS) return Promise.resolve();

  enCours = (async () => {
    try {
      const avant = getUtilisateur();
      // 401 (session expirée ou trop ancienne, compte désactivé) : apiFetch déconnecte déjà.
      const reponse = await apiFetch(`${API_URL}/auth/session`);
      if (!reponse.ok) return;
      const { token, utilisateur } = (await reponse.json()) as { token: string; utilisateur: UtilisateurConnecte };
      // Déconnecté (ou autre compte connecté) pendant la requête : rien à mettre à jour.
      if (!getToken() || getUtilisateur()?.id !== utilisateur.id) return;

      dernierRenouvellement = Date.now();
      setToken(token);
      setUtilisateur(utilisateur);
      if (!avant) return;
      // Rattaché à une autre société : rien de ce qui est gardé sur l'appareil (fiches hors ligne,
      // écrans ouverts) ne doit rester — reconnexion, qui purge tout.
      if (avant.societeId !== utilisateur.societeId) {
        seDeconnecter();
        return;
      }
      if (avant.role !== utilisateur.role || avant.superAdmin !== utilisateur.superAdmin) {
        window.dispatchEvent(new Event(EVENEMENT_COMPTE_MODIFIE));
      }
    } catch {
      // Réseau coupé pendant la requête : simplement retenté à la prochaine occasion.
    } finally {
      enCours = null;
    }
  })();
  return enCours;
}

// À appeler une fois connecté (voir App.tsx) ; renvoie de quoi tout arrêter à la déconnexion.
export function demarrerRenouvellementSession(): () => void {
  const relancer = () => {
    rafraichirSession().catch(() => {});
  };
  const surVisibilite = () => {
    if (document.visibilityState === "visible") relancer();
  };

  relancer();
  const minuterie = window.setInterval(relancer, INTERVALLE_RENOUVELLEMENT_MS);
  document.addEventListener("visibilitychange", surVisibilite);
  window.addEventListener("online", relancer);
  return () => {
    window.clearInterval(minuterie);
    document.removeEventListener("visibilitychange", surVisibilite);
    window.removeEventListener("online", relancer);
    dernierRenouvellement = 0;
  };
}
