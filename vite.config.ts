import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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