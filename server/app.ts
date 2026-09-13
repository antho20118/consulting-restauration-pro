import express from "express";
import cors from "cors";

import articlesRouter from "./routes/articles.js";
import categoriesRouter from "./routes/categories.js";
import unitesRouter from "./routes/unites.js";
import recettesRouter from "./routes/recettes.js";
import dashboardRouter from "./routes/dashboard.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/articles", articlesRouter);
app.use("/categories", categoriesRouter);
app.use("/unites", unitesRouter);
app.use("/recettes", recettesRouter);
app.use("/dashboard", dashboardRouter);

app.get("/", (_req, res) => {
  res.json({
    application: "Consulting Restauration Pro",
    version: "1.0.0",
    status: "OK",
  });
});

export default app;