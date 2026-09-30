import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { ErrorRequestHandler } from "express";

import prisma from "../../server/prisma.js";
import { journaliserErreur, contexteDepuisRequete } from "../../server/utils/journalErreurs.js";

// Vérifie le mécanisme du filet de sécurité global posé dans server/app.ts — un mini serveur dédié
// ici (même code que le gestionnaire réel) plutôt qu'une route existante, pour ne jamais dépendre
// d'un moyen artificiel de faire planter une vraie route métier. C'est exactement la classe de bug
// qui a motivé ce chantier : une erreur survenue dans un middleware exécuté AVANT toute route (ex.
// requireAuth) n'a par construction aucun try/catch de routeur qui l'attende ; Express 5 forwarde
// automatiquement une promesse rejetée d'un middleware async vers ce gestionnaire.
test("le gestionnaire d'erreur global journalise et répond 500 pour une erreur async survenue dans un middleware", async () => {
  const app = express();
  app.use(async () => {
    await Promise.resolve();
    throw new Error("panne volontaire de test middleware asynchrone");
  });
  const gestionnaire: ErrorRequestHandler = async (err, req, res, next) => {
    await journaliserErreur(err, "SERVEUR", contexteDepuisRequete(req, 500));
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(500).json({ error: "Une erreur interne est survenue" });
  };
  app.use(gestionnaire);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");

  try {
    const reponse = await fetch(`http://127.0.0.1:${adresse.port}/quoi-que-ce-soit`);
    assert.equal(reponse.status, 500);
    assert.deepEqual(await reponse.json(), { error: "Une erreur interne est survenue" });

    const entree = await prisma.journalErreur.findFirst({
      where: { message: "panne volontaire de test middleware asynchrone" },
      orderBy: { id: "desc" },
    });
    assert.ok(entree);
    assert.equal(entree!.statutHttp, 500);
    await prisma.journalErreur.delete({ where: { id: entree!.id } });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
