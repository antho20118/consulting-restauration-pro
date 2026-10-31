import app from "./app.js";
import prisma from "./prisma.js";
import { demarrerSauvegardesExternes } from "./utils/sauvegardeExterne/planificateur.js";

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API démarrée sur http://localhost:${PORT}`);
});

// Sauvegarde de la base hors de Railway, chaque nuit (voir server/utils/sauvegardeExterne/) —
// démarrée ici et non dans app.ts, pour que les tests qui importent l'application ne la lancent
// jamais.
demarrerSauvegardesExternes(prisma);
