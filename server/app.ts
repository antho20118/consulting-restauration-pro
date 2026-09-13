import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";

import articlesRouter from "./routes/articles.js";
import categoriesRouter from "./routes/categories.js";
import unitesRouter from "./routes/unites.js";
import recettesRouter from "./routes/recettes.js";
import dashboardRouter from "./routes/dashboard.js";
import societeRouter from "./routes/societe.js";
import fournisseursRouter from "./routes/fournisseurs.js";
import tvaRouter from "./routes/tva.js";
import allergenesRouter from "./routes/allergenes.js";
import mouvementsRouter from "./routes/mouvements.js";
import depotsRouter from "./routes/depots.js";

const app = express();

app.use(cors());
app.use(express.json());

// Préfixées par /api pour ne pas entrer en collision avec les routes du frontend
// une fois servi par ce même serveur en production (ex. /recettes est une page React).
app.use("/api/articles", articlesRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/unites", unitesRouter);
app.use("/api/recettes", recettesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/societe", societeRouter);
app.use("/api/fournisseurs", fournisseursRouter);
app.use("/api/tva", tvaRouter);
app.use("/api/allergenes", allergenesRouter);
app.use("/api/mouvements", mouvementsRouter);
app.use("/api/depots", depotsRouter);

app.get("/health", (_req, res) => {
  res.json({
    application: "Consulting Restauration Pro",
    version: "1.0.0",
    status: "OK",
  });
});

// En production, l'API sert aussi le frontend buildé (un seul service à déployer).
// En développement, le frontend tourne séparément via le serveur de dev Vite.
if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.resolve(__dirname, "../dist");

  // index.html doit toujours être revalidé (sinon certains navigateurs, notamment Safari,
  // continuent de servir une version en cache après un déploiement) ; les fichiers de dist/assets
  // ont un nom qui change avec leur contenu (hash Vite), donc peuvent être mis en cache longtemps.
  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );

  app.use((req, res, next) => {
    if (req.method !== "GET") {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(distPath, "index.html"));
  });
}

export default app;