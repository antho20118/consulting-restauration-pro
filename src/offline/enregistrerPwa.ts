import { registerSW } from "virtual:pwa-register";
import { CACHE_LECTURES_HORS_LIGNE } from "./nomCache";

// Enregistrement explicite (plutôt que l'auto-injection de vite-plugin-pwa, voir injectRegister:
// null dans vite.config.ts) : seul moyen d'accrocher la purge du cache de lectures hors ligne à la
// déconnexion (événement "auth:logout", voir src/config/api.ts) — sans ça, les fiches recettes/
// menus/HACCP d'un compte resteraient consultables hors ligne après la connexion d'un autre compte
// sur le même appareil partagé en cuisine.
export function enregistrerPwa(): void {
  if (!("serviceWorker" in navigator)) return;

  registerSW({ immediate: true });

  window.addEventListener("auth:logout", () => {
    caches.delete(CACHE_LECTURES_HORS_LIGNE).catch(() => {
      // Best-effort : une purge échouée ne doit jamais bloquer la déconnexion elle-même.
    });
  });
}
