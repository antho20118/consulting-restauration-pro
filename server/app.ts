import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";

import authRouter from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { autoriserEcriture } from "./middleware/autoriserEcriture.js";
import { requireRole } from "./middleware/requireRole.js";
import utilisateursRouter from "./routes/utilisateurs.js";
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
import achatsRouter from "./routes/achats.js";
import commandesRouter from "./routes/commandes.js";
import productionRouter from "./routes/production.js";
import productionsRouter from "./routes/productions.js";
import haccpRouter from "./routes/haccp.js";
import consultingRouter from "./routes/consulting.js";
import documentsFournisseursRouter from "./routes/documentsFournisseurs.js";
import listingsFournisseurRouter from "./routes/listingsFournisseur.js";
import ventesRouter from "./routes/ventes.js";
import sauvegardesRouter from "./routes/sauvegardes.js";

const app = express();

// Sans CORS_ORIGIN, comportement inchangé (toutes origines acceptées) : ne restreint que si
// l'opérateur choisit explicitement de le faire (liste d'origines séparées par des virgules).
const corsOrigin = process.env.CORS_ORIGIN;
app.use(
  cors(
    corsOrigin
      ? { origin: corsOrigin.split(",").map((v) => v.trim()).filter(Boolean) }
      : undefined
  )
);
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

// Matrice de permissions par rôle (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma) : posée
// ici, groupe de routeurs par groupe de routeurs, plutôt qu'éparpillée dans chacun des 24 fichiers
// de routes, pour que la matrice entière reste auditable en un seul endroit. La lecture (GET) reste
// toujours ouverte à tout rôle authentifié de la société (voir autoriserEcriture.ts) — seule
// l'écriture est bornée ; un routeur qui ne mute jamais réellement la base (dashboard, haccp en
// lecture seule, consulting/production qui ne font qu'un calcul à la volée jamais persisté) n'a
// donc besoin d'aucune restriction supplémentaire.
const ECRITURE_GESTION = autoriserEcriture(["PROPRIETAIRE", "CHEF"]);
const ECRITURE_OPERATIONNEL = autoriserEcriture(["PROPRIETAIRE", "CHEF", "CUISINIER"]);

app.use("/api/utilisateurs", utilisateursRouter);
app.use("/api/articles", ECRITURE_GESTION, articlesRouter);
app.use("/api/categories", ECRITURE_GESTION, categoriesRouter);
app.use("/api/categories-recette", ECRITURE_GESTION, categoriesRecetteRouter);
app.use("/api/sous-categories-recette", ECRITURE_GESTION, sousCategoriesRecetteRouter);
app.use("/api/unites", ECRITURE_GESTION, unitesRouter);
app.use("/api/recettes", ECRITURE_GESTION, recettesRouter);
app.use("/api/menus", ECRITURE_GESTION, menusRouter);
app.use("/api/dashboard", dashboardRouter);
// Paramètres société (SIRET, coefficient multiplicateur) : plus sensible que la gestion courante,
// modification réservée au PROPRIETAIRE — jamais au CHEF, contrairement au reste du groupe gestion.
app.use("/api/societe", autoriserEcriture(["PROPRIETAIRE"]), societeRouter);
app.use("/api/fournisseurs", ECRITURE_GESTION, fournisseursRouter);
app.use("/api/tva", ECRITURE_GESTION, tvaRouter);
app.use("/api/allergenes", ECRITURE_GESTION, allergenesRouter);
app.use("/api/mouvements", ECRITURE_OPERATIONNEL, mouvementsRouter);
app.use("/api/depots", ECRITURE_GESTION, depotsRouter);
app.use("/api/alias-ingredients", ECRITURE_GESTION, aliasIngredientsRouter);
app.use("/api/achats", ECRITURE_GESTION, achatsRouter);
app.use("/api/commandes", ECRITURE_GESTION, commandesRouter);
app.use("/api/production", productionRouter);
app.use("/api/productions", ECRITURE_OPERATIONNEL, productionsRouter);
app.use("/api/haccp", haccpRouter);
app.use("/api/consulting", consultingRouter);
app.use("/api/documents-fournisseurs", ECRITURE_GESTION, documentsFournisseursRouter);
app.use("/api/listings-fournisseur", ECRITURE_GESTION, listingsFournisseurRouter);
app.use("/api/ventes", ECRITURE_GESTION, ventesRouter);
app.use("/api/sauvegardes", requireRole(["PROPRIETAIRE"]), sauvegardesRouter);

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