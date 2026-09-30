// Constante partagée entre vite.config.ts (déclaration du cache Workbox) et
// src/offline/enregistrerPwa.ts (purge à la déconnexion) — fichier à part, sans aucun autre
// import, pour ne jamais faire entrer le code de configuration Vite (Node, vite-plugin-pwa) dans
// le bundle navigateur.
export const CACHE_LECTURES_HORS_LIGNE = "lectures-hors-ligne";
