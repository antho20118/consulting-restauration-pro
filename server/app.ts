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

app.use("/articles", articlesRouter);
app.use("/categories", categoriesRouter);
app.use("/unites", unitesRouter);
app.use("/recettes", recettesRouter);
app.use("/dashboard", dashboardRouter);
app.use("/societe", societeRouter);
app.use("/fournisseurs", fournisseursRouter);
app.use("/tva", tvaRouter);
app.use("/allergenes", allergenesRouter);
app.use("/mouvements", mouvementsRouter);
app.use("/depots", depotsRouter);

app.get("/", (_req, res) => {
  res.json({
    application: "Consulting Restauration Pro",
    version: "1.0.0",
    status: "OK",
  });
});

export default app;