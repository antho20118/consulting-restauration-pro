import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { CACHE_LECTURES_HORS_LIGNE } from "./src/offline/nomCache.js";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "autoUpdate" : la nouvelle version du service worker s'active dès qu'elle est prête, sans
      // exiger un rechargement manuel — acceptable ici (aucun état local de service worker à
      // préserver entre versions), plus simple qu'un flux d'invite à mettre à jour pour un premier
      // chantier offline.
      registerType: "autoUpdate",
      injectRegister: null,
      manifest: {
        name: "Consulting Restauration Pro",
        short_name: "Consulting Resto",
        description: "Fiches recettes, coûts, HACCP et production pour la restauration.",
        theme_color: "#16a085",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // SPA : toute navigation (changement de route) doit resservir l'app déjà mise en cache
        // hors ligne, jamais une erreur réseau brute.
        navigateFallback: "/index.html",
        // Les binaires Tesseract (repli OCR gratuit sans IA, voir ocrPhoto.ts) pèsent ~8 Mo à eux
        // deux : jamais précachés à l'installation (coûterait cette bande passante à CHAQUE
        // visiteur, y compris ceux qui n'utilisent jamais l'OCR) — seulement mis en cache à la
        // demande, la première fois qu'ils sont réellement utilisés (runtimeCaching ci-dessous).
        globIgnores: ["**/tesseract/**"],
        runtimeCaching: [
          {
            // CacheFirst : ces fichiers sont versionnés par leur propre nom (jamais réécrits une
            // fois publiés), donc jamais besoin de revalider auprès du réseau une fois en cache —
            // et ça permet au repli OCR de fonctionner hors ligne dès la première utilisation.
            urlPattern: /\/tesseract\//,
            handler: "CacheFirst",
            options: {
              cacheName: "tesseract-ocr",
              expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
          {
            // Lecture seule et volontairement restreinte aux pages consultables en cuisine sans
            // réseau (recettes, menus, évaluation HACCP, productions) — jamais les routes
            // d'écriture (POST/PUT/DELETE), exclues ici par "method: GET" plutôt que par la seule
            // forme de l'URL, pour ne jamais mettre en cache par erreur la réponse d'une écriture.
            urlPattern: /\/api\/(recettes|menus|productions)(\/\d+)?(\?.*)?$/,
            method: "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: CACHE_LECTURES_HORS_LIGNE,
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 300, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /\/api\/haccp\/evaluer\/\d+$/,
            method: "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: CACHE_LECTURES_HORS_LIGNE,
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 300, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    // DataGrid (~640 kB) et xlsx (~424 kB) dépassent le seuil par défaut, mais sont déjà dans des
    // chunks séparés par route (voir AppRoutes.tsx, lazy()) : ils ne se chargent jamais au premier
    // accès (vérifié — le Dashboard ne charge que index.js + DashboardPage.js, ~340 kB), seulement
    // en visitant une page qui les utilise réellement. Le seuil par défaut (500 kB) n'a donc rien à
    // signaler ici ; on l'ajuste juste au-dessus de leur taille pour ne plus avoir ce faux positif.
    chunkSizeWarningLimit: 700,
  },
});