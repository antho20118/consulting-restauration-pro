import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Correction du trou identifié après le chantier « identité fournisseur + produit fournisseur » :
// un Fournisseur créé automatiquement par trouverOuCreerFournisseur (server/routes/articles.ts,
// atteint pendant un import listing quand le nom ne correspond à aucun fournisseur existant) ne
// recevait jamais de codeFournisseur — contrairement à la création manuelle (POST /fournisseurs,
// qui le génère toujours). Le champ restait alors null pour toujours (rien ne le renseigne après
// coup), invisible dans l'interface (FournisseursGrille.tsx n'affiche rien si null). Couvre : la
// création automatique via import reçoit désormais un code (Cas 1), la résolution d'un fournisseur
// déjà existant par nom ne touche jamais à son code existant, y compris s'il est déjà null pour un
// fournisseur d'avant cette correction (Cas 2), et le script de rattrapage ponctuel
// prisma/backfillCodeFournisseur.ts (Cas 3-4).

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function poster(corps: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corps),
  });
  return { status: reponse.status, corps: await reponse.json() };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  token = await connecterAdminDeTest(baseUrl);

  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
});

after(async () => {
  const documents = await prisma.documentFournisseur.findMany({
    where: { fournisseur: { nom: { startsWith: "CODE AUTO TEST" } } },
    select: { id: true },
  });
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { documentId: { in: documents.map((d) => d.id) } } });
  await prisma.documentFournisseur.deleteMany({ where: { id: { in: documents.map((d) => d.id) } } });
  await prisma.tarifArticle.deleteMany({
    where: {
      OR: [
        { fournisseur: { nom: { startsWith: "CODE AUTO TEST" } } },
        { article: { nom: { startsWith: "CODE AUTO TEST" } } },
      ],
    },
  });
  await prisma.article.deleteMany({ where: { nom: { startsWith: "CODE AUTO TEST" } } });
  await prisma.fournisseur.deleteMany({ where: { nom: { startsWith: "CODE AUTO TEST" } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("1. import générique créant un fournisseur inédit par son nom : le fournisseur reçoit un codeFournisseur au format FOU-XXXX", async () => {
  const nomFournisseur = "CODE AUTO TEST VIBEL";

  const { status, corps } = await poster({
    societeId,
    fournisseurNom: nomFournisseur,
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    lignes: [{ designation: "CODE AUTO TEST Camembert Affine", prix: "5.00" }],
  });
  assert.equal(status, 200);
  assert.equal(corps.crees, 1);

  const fournisseur = await prisma.fournisseur.findFirstOrThrow({ where: { nom: nomFournisseur } });
  assert.ok(fournisseur.codeFournisseur, "le fournisseur créé automatiquement par import doit recevoir un codeFournisseur");
  assert.match(fournisseur.codeFournisseur!, /^FOU-\d{4,}$/);
});

test("2. résolution d'un fournisseur déjà existant par son nom : jamais de génération ni de modification de son codeFournisseur", async () => {
  // Fournisseur créé directement en base sans code (simule un fournisseur d'avant cette correction,
  // ou un fournisseur historique jamais rattrapé) : la résolution par nom doit le réutiliser tel
  // quel, sans jamais lui assigner un code après coup à cette occasion (seul le rattrapage explicite,
  // voir tests 3-4, ou une modification manuelle, peut le faire).
  const fournisseurExistant = await prisma.fournisseur.create({
    data: { nom: "CODE AUTO TEST SUPER U", societeId, codeFournisseur: null },
  });

  const { status, corps } = await poster({
    societeId,
    fournisseurNom: "CODE AUTO TEST SUPER U",
    categorieId,
    tvaId,
    type: "MATIERE_PREMIERE",
    lignes: [{ designation: "CODE AUTO TEST Farine Ble Type55", prix: "6.00" }],
  });
  assert.equal(status, 200);
  assert.equal(corps.crees, 1);

  const fournisseurApres = await prisma.fournisseur.findUniqueOrThrow({ where: { id: fournisseurExistant.id } });
  assert.equal(fournisseurApres.codeFournisseur, null, "la réutilisation d'un fournisseur existant ne doit jamais toucher à son codeFournisseur");

  const article = await prisma.article.findFirstOrThrow({ where: { nom: "CODE AUTO TEST Farine Ble Type55" } });
  const tarif = await prisma.tarifArticle.findFirstOrThrow({ where: { articleId: article.id, actif: true } });
  assert.equal(tarif.fournisseurId, fournisseurExistant.id, "aucun second fournisseur créé, celui existant est bien réutilisé");
});

test("3. script de rattrapage (prisma/backfillCodeFournisseur.ts) : assigne un code à tous les fournisseurs qui n'en ont pas", async () => {
  const f1 = await prisma.fournisseur.create({ data: { nom: "CODE AUTO TEST Rattrapage A", societeId, codeFournisseur: null } });
  const f2 = await prisma.fournisseur.create({ data: { nom: "CODE AUTO TEST Rattrapage B", societeId, codeFournisseur: null } });
  const dejaCode = await prisma.fournisseur.create({ data: { nom: "CODE AUTO TEST Rattrapage Deja Code", societeId, codeFournisseur: "FOU-9001" } });

  const resultat = spawnSync(process.execPath, ["--import", "tsx", "prisma/backfillCodeFournisseur.ts"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(resultat.status, 0, `le script doit réussir. stderr: ${resultat.stderr}`);

  const f1Apres = await prisma.fournisseur.findUniqueOrThrow({ where: { id: f1.id } });
  const f2Apres = await prisma.fournisseur.findUniqueOrThrow({ where: { id: f2.id } });
  const dejaCodeApres = await prisma.fournisseur.findUniqueOrThrow({ where: { id: dejaCode.id } });

  assert.ok(f1Apres.codeFournisseur, "f1 doit recevoir un code");
  assert.ok(f2Apres.codeFournisseur, "f2 doit recevoir un code");
  assert.match(f1Apres.codeFournisseur!, /^FOU-\d{4,}$/);
  assert.match(f2Apres.codeFournisseur!, /^FOU-\d{4,}$/);
  assert.notEqual(f1Apres.codeFournisseur, f2Apres.codeFournisseur, "deux codes distincts, jamais de doublon");
  assert.equal(dejaCodeApres.codeFournisseur, "FOU-9001", "un fournisseur ayant déjà un code n'est jamais modifié par le script");
});

test("4. script de rattrapage : idempotent, une seconde exécution ne modifie plus rien", async () => {
  const f = await prisma.fournisseur.create({ data: { nom: "CODE AUTO TEST Rattrapage Idempotent", societeId, codeFournisseur: null } });

  const premiereExecution = spawnSync(process.execPath, ["--import", "tsx", "prisma/backfillCodeFournisseur.ts"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(premiereExecution.status, 0);
  const apresPremiere = await prisma.fournisseur.findUniqueOrThrow({ where: { id: f.id } });
  assert.ok(apresPremiere.codeFournisseur);

  const secondeExecution = spawnSync(process.execPath, ["--import", "tsx", "prisma/backfillCodeFournisseur.ts"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(secondeExecution.status, 0);
  assert.match(secondeExecution.stdout, /Aucun fournisseur sans code/, `la seconde exécution doit être un no-op. stdout: ${secondeExecution.stdout}`);

  const apresSeconde = await prisma.fournisseur.findUniqueOrThrow({ where: { id: f.id } });
  assert.equal(apresSeconde.codeFournisseur, apresPremiere.codeFournisseur, "le code ne doit jamais être régénéré ou changé par une exécution ultérieure");
});
