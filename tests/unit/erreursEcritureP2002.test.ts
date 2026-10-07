import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import type { Express } from "express";
import type { Server } from "node:http";
import { Prisma } from "@prisma/client";

import prisma from "../../server/prisma.js";
import { repondreErreurEcriture } from "../../server/utils/erreursEcriture.js";

// PR A de l'audit F09/F10 : P2002 (violation de contrainte unique Postgres) n'était traduit nulle
// part dans repondreErreurEcriture — il retombait dans le dernier recours générique (500, message
// par défaut du routeur appelant), alors que c'est une erreur parfaitement prévisible côté
// appelant (doublon), au même titre que P2003 (→400) et P2025 (→404) déjà gérés juste au-dessus
// dans ce même fichier. Ce test construit directement une `Prisma.PrismaClientKnownRequestError`
// (jamais une vraie violation via une route existante : voir gestionnaireErreurGlobal.test.ts pour
// le même principe — ne jamais dépendre d'un moyen artificiel de faire planter une route métier)
// et l'envoie au travers d'une mini app Express dédiée, pour tester `repondreErreurEcriture`
// isolément de tout routeur réel, avec un vrai `res` Express (jamais un mock à la main) et une
// vraie requête HTTP (`fetch`), exactement le principe déjà établi dans ce dépôt.

function construireAppTest(erreurALever: unknown, messageParDefaut: string): Express {
  const app = express();
  app.get("/test-erreur", async (req, res) => {
    await repondreErreurEcriture(erreurALever, res, messageParDefaut, req);
  });
  return app;
}

async function demarrer(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  return { server, baseUrl: `http://127.0.0.1:${adresse.port}` };
}

function fermer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function creerErreurP2002(messageUnique: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(messageUnique, {
    code: "P2002",
    clientVersion: "6.19.3",
    meta: meta ?? { target: ["societeId", "nom"], modelName: "SousCategorieRecette" },
  });
}

test("P2002 : traduit en 409 avec un message générique stable, sans fuite d'information interne", async () => {
  const messageInterne = `Unique constraint failed on the fields: (\`societeId\`,\`nom\`) — ${randomUUID()}`;
  const app = construireAppTest(creerErreurP2002(messageInterne), "Message par défaut non attendu");
  const { server, baseUrl } = await demarrer(app);
  try {
    const reponse = await fetch(`${baseUrl}/test-erreur`);
    assert.equal(reponse.status, 409);
    const corps = await reponse.json();
    assert.deepEqual(corps, { error: "Une ressource avec ces informations existe déjà" });

    const texteBrut = JSON.stringify(corps);
    assert.ok(!texteBrut.includes("PrismaClientKnownRequestError"), "jamais le nom de la classe d'erreur Prisma");
    assert.ok(!texteBrut.includes("societeId"), "jamais le nom de colonne interne");
    assert.ok(!texteBrut.includes("SousCategorieRecette"), "jamais le nom de table/modèle interne");
    assert.ok(!texteBrut.includes("Unique constraint"), "jamais le message Prisma brut");
    assert.ok(!texteBrut.includes("stack"), "jamais de stack trace");

    // P2002 est une erreur métier prévisible (comme P2003/P2025/FournisseurAmbiguError juste
    // au-dessus dans erreursEcriture.ts) : jamais journalisée, au même titre que ces cas-là.
    const entree = await prisma.journalErreur.findFirst({ where: { message: messageInterne } });
    assert.equal(entree, null, "une violation P2002 ne doit jamais être journalisée (erreur métier prévisible, pas une panne serveur)");
  } finally {
    await fermer(server);
  }
});

test("P2002 avec meta.target présent : toujours aucune fuite, quel que soit le contenu de meta", async () => {
  const messageInterne = `Unique constraint failed — ${randomUUID()}`;
  const app = construireAppTest(
    creerErreurP2002(messageInterne, { target: ["codeFournisseur"], modelName: "Fournisseur" }),
    "Message par défaut non attendu"
  );
  const { server, baseUrl } = await demarrer(app);
  try {
    const reponse = await fetch(`${baseUrl}/test-erreur`);
    assert.equal(reponse.status, 409);
    const corps = await reponse.json();
    assert.deepEqual(corps, { error: "Une ressource avec ces informations existe déjà" });
    const texteBrut = JSON.stringify(corps);
    assert.ok(!texteBrut.includes("codeFournisseur"));
    assert.ok(!texteBrut.includes("Fournisseur"));
  } finally {
    await fermer(server);
  }
});

test("P2003 (déjà supporté) : comportement inchangé — 400, message existant", async () => {
  const erreur = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
    code: "P2003",
    clientVersion: "6.19.3",
    meta: { field_name: "categorieId" },
  });
  const app = construireAppTest(erreur, "Message par défaut non attendu");
  const { server, baseUrl } = await demarrer(app);
  try {
    const reponse = await fetch(`${baseUrl}/test-erreur`);
    assert.equal(reponse.status, 400);
    assert.deepEqual(await reponse.json(), {
      error: "Référence invalide : un champ désigne un enregistrement inexistant",
    });
  } finally {
    await fermer(server);
  }
});

test("P2025 (déjà supporté) : comportement inchangé — 404, message existant", async () => {
  const erreur = new Prisma.PrismaClientKnownRequestError("An operation failed because it depends on one or more records that were required but not found", {
    code: "P2025",
    clientVersion: "6.19.3",
  });
  const app = construireAppTest(erreur, "Message par défaut non attendu");
  const { server, baseUrl } = await demarrer(app);
  try {
    const reponse = await fetch(`${baseUrl}/test-erreur`);
    assert.equal(reponse.status, 404);
    assert.deepEqual(await reponse.json(), { error: "Ressource introuvable" });
  } finally {
    await fermer(server);
  }
});

test("code Prisma inconnu (ni P2002/P2003/P2025) : comportement inchangé — 500 générique, journalisé", async () => {
  const messageInterne = `Erreur Prisma simulée inconnue ${randomUUID()}`;
  const messageParDefaut = `Message par défaut de test ${randomUUID()}`;
  const erreur = new Prisma.PrismaClientKnownRequestError(messageInterne, {
    code: "P9999",
    clientVersion: "6.19.3",
  });
  const app = construireAppTest(erreur, messageParDefaut);
  const { server, baseUrl } = await demarrer(app);
  try {
    const reponse = await fetch(`${baseUrl}/test-erreur`);
    assert.equal(reponse.status, 500);
    assert.deepEqual(await reponse.json(), { error: messageParDefaut });

    const entree = await prisma.journalErreur.findFirst({ where: { message: messageInterne } });
    assert.ok(entree, "une erreur Prisma non reconnue doit rester journalisée comme avant");
    await prisma.journalErreur.delete({ where: { id: entree!.id } });
  } finally {
    await fermer(server);
  }
});

test("erreur JavaScript classique (Error) : comportement inchangé — 500 générique, journalisé", async () => {
  const messageInterne = `panne volontaire de test ${randomUUID()}`;
  const messageParDefaut = `Message par défaut de test ${randomUUID()}`;
  const erreur = new Error(messageInterne);
  const app = construireAppTest(erreur, messageParDefaut);
  const { server, baseUrl } = await demarrer(app);
  try {
    const reponse = await fetch(`${baseUrl}/test-erreur`);
    assert.equal(reponse.status, 500);
    assert.deepEqual(await reponse.json(), { error: messageParDefaut });

    const entree = await prisma.journalErreur.findFirst({ where: { message: messageInterne } });
    assert.ok(entree, "une erreur JavaScript classique doit rester journalisée comme avant");
    await prisma.journalErreur.delete({ where: { id: entree!.id } });
  } finally {
    await fermer(server);
  }
});
