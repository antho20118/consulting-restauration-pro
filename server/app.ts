import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";

import authRouter from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";
import articlesRouter from "./routes/articles.js";
import categoriesRouter from "./routes/categories.js";
import categoriesRecetteRouter from "./routes/categoriesRecette.js";
import sousCategoriesRecetteRouter from "./routes/sousCategoriesRecette.js";
import unitesRouter from "./routes/unites.js";
import recettesRouter from "./routes/recettes.js";
import menusRouter from "./routes/menus.js";
import dashboardRouter from "./routes/dashboard.js";
import societeRouter from "./routes/societe.js";
import fournisseursRouter from "./routes/fournisseurs.js";
import tvaRouter from "./routes/tva.js";
import allergenesRouter from "./routes/allergenes.js";
import mouvementsRouter from "./routes/mouvements.js";
import depotsRouter from "./routes/depots.js";
import aliasIngredientsRouter from "./routes/aliasIngredients.js";
import productionRouter from "./routes/production.js";
import haccpRouter from "./routes/haccp.js";

const app = express();

app.use(cors());
// Limite par défaut d'Express (100kb) trop basse pour un listing fournisseur complet
// (plusieurs milliers de lignes une fois transformées en JSON par le frontend).
app.use(express.json({ limit: "10mb" }));

// Préfixées par /api pour ne pas entrer en collision avec les routes du frontend
// une fois servi par ce même serveur en production (ex. /recettes est une page React).
// /api/auth est montée avant le garde d'authentification : la connexion doit rester accessible
// sans jeton. Tout le reste de l'API l'exige (vérifié côté serveur, pas seulement caché côté
// client, sans quoi l'écran de connexion serait contournable en appelant l'API directement).
app.use("/api/auth", authRouter);
app.use("/api", requireAuth);

app.use("/api/articles", articlesRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/categories-recette", categoriesRecetteRouter);
app.use("/api/sous-categories-recette", sousCategoriesRecetteRouter);
app.use("/api/unites", unitesRouter);
app.use("/api/recettes", recettesRouter);
app.use("/api/menus", menusRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/societe", societeRouter);
app.use("/api/fournisseurs", fournisseursRouter);
app.use("/api/tva", tvaRouter);
app.use("/api/allergenes", allergenesRouter);
app.use("/api/mouvements", mouvementsRouter);
app.use("/api/depots", depotsRouter);
app.use("/api/alias-ingredients", aliasIngredientsRouter);
app.use("/api/production", productionRouter);
app.use("/api/haccp", haccpRouter);

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