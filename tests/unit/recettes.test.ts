import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre POST/PUT /api/recettes (app Express réelle, Postgres configuré
// par DATABASE_URL). Voir tests/unit/mouvements.test.ts pour le même principe appliqué à un autre
// endpoint.
//
// Corrige un bug trouvé lors de l'audit fonctionnel de l'agent Consulting : calculerCoutRecette()
// (qui valide entre autres portions > 0) était appelée APRÈS l'écriture Prisma, pour construire la
// réponse JSON — une recette invalide (ex. portions=0) était donc bel et bien enregistrée en base
// malgré la réponse 500 renvoyée au client, la rendant ensuite impossible à consulter/analyser (au
// minimum via POST /api/consulting/analyser-recette, qui lève la même exception). Le correctif
// place l'appel à calculerCoutRecette DANS la même transaction Prisma que l'écriture : une
// validation qui échoue annule désormais tout ce qui a été écrit.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let categorieRecetteId: number;
let tvaId: number;
let fournisseurId: number;
let conditionnementId: number;
let uniteKgId: number;
let articleId: number;
const recetteIds: number[] = [];

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({
      data: { identifiant: "admin", codeHache: hacherCode("1234") },
    });
  }

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: "admin", code: "1234" }),
  });
  assert.equal(
    reponseLogin.status,
    200,
    "Connexion admin/1234 impossible : un identifiant différent est déjà configuré sur cette base de test."
  );
  token = (await reponseLogin.json()).token;

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;

  const categorie =
    (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;

  const categorieRecette =
    (await prisma.categorieRecette.findFirst()) ??
    (await prisma.categorieRecette.create({ data: { nom: "Catégorie recette de test" } }));
  categorieRecetteId = categorieRecette.id;

  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "Fournisseur test recettes", societeId } });
  fournisseurId = fournisseur.id;

  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));
  conditionnementId = conditionnement.id;

  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;

  const article = await prisma.article.create({
    data: {
      nom: "RECETTES TEST ARTICLE",
      reference: "TESTRECETTES-ARTICLE",
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      actif: true,
    },
  });
  articleId = article.id;
  await prisma.tarifArticle.create({
    data: {
      articleId,
      fournisseurId,
      uniteId: uniteKgId,
      conditionnementId,
      quantiteConditionnement: 1,
      prixHT: 10,
      actif: true,
    },
  });
});

after(async () => {
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  await prisma.recette.deleteMany({ where: { nom: { startsWith: "RECETTES TEST" } } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.deleteMany({ where: { id: articleId } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("POST /api/recettes avec portions=0 : échoue (500) ET n'enregistre RIEN en base (pas de recette fantôme)", async () => {
  const nomUnique = "RECETTES TEST creation portions zero";

  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nom: nomUnique,
      societeId,
      categorieId: categorieRecetteId,
      portions: 0,
      lignes: [{ articleId, quantite: 1, uniteId: uniteKgId }],
      etapes: [],
    }),
  });
  assert.equal(reponse.status, 500);

  const enBase = await prisma.recette.findFirst({ where: { nom: nomUnique } });
  assert.equal(enBase, null, "La recette n'aurait jamais dû être enregistrée en base après un 500.");
});

test("POST /api/recettes avec des données valides : fonctionne normalement (régression du correctif transactionnel)", async () => {
  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nom: "RECETTES TEST creation valide",
      societeId,
      categorieId: categorieRecetteId,
      portions: 4,
      lignes: [{ articleId, quantite: 1, uniteId: uniteKgId }],
      etapes: [],
    }),
  });
  assert.equal(reponse.status, 201);
  const recette = await reponse.json();
  recetteIds.push(recette.id);
  assert.equal(recette.coutTotal, 10);

  const enBase = await prisma.recette.findUnique({ where: { id: recette.id } });
  assert.ok(enBase, "La recette valide aurait dû être enregistrée en base.");
});

test("PUT /api/recettes/:id avec portions=0 : échoue (500) ET laisse la recette existante totalement inchangée", async () => {
  const creation = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nom: "RECETTES TEST modification portions zero AVANT",
      societeId,
      categorieId: categorieRecetteId,
      portions: 4,
      lignes: [{ articleId, quantite: 1, uniteId: uniteKgId }],
      etapes: [],
    }),
  });
  const recette = await creation.json();
  recetteIds.push(recette.id);

  const avant = await prisma.recette.findUnique({ where: { id: recette.id }, include: { lignes: true } });

  const reponse = await fetch(`${baseUrl}/api/recettes/${recette.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nom: "RECETTES TEST modification portions zero APRES (ne devrait jamais être enregistré)",
      categorieId: categorieRecetteId,
      portions: 0,
      lignes: [{ articleId, quantite: 999, uniteId: uniteKgId }],
      etapes: [],
    }),
  });
  assert.equal(reponse.status, 500);

  const apres = await prisma.recette.findUnique({ where: { id: recette.id }, include: { lignes: true } });
  assert.equal(apres?.nom, avant?.nom, "Le nom n'aurait pas dû changer.");
  assert.equal(apres?.portions, avant?.portions, "Le nombre de portions n'aurait pas dû changer.");
  assert.equal(apres?.lignes.length, avant?.lignes.length, "Les lignes n'auraient pas dû être remplacées.");
  assert.equal(apres?.lignes[0]?.quantite, avant?.lignes[0]?.quantite, "La quantité de la ligne n'aurait pas dû changer.");
});

test("PUT /api/recettes/:id avec des données valides : fonctionne normalement (régression du correctif transactionnel)", async () => {
  const creation = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nom: "RECETTES TEST modification valide AVANT",
      societeId,
      categorieId: categorieRecetteId,
      portions: 2,
      lignes: [{ articleId, quantite: 1, uniteId: uniteKgId }],
      etapes: [],
    }),
  });
  const recette = await creation.json();
  recetteIds.push(recette.id);

  const reponse = await fetch(`${baseUrl}/api/recettes/${recette.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nom: "RECETTES TEST modification valide APRES",
      categorieId: categorieRecetteId,
      portions: 5,
      lignes: [{ articleId, quantite: 2, uniteId: uniteKgId }],
      etapes: [],
    }),
  });
  assert.equal(reponse.status, 200);
  const misAJour = await reponse.json();
  assert.equal(misAJour.nom, "RECETTES TEST modification valide APRES");
  assert.equal(misAJour.portions, 5);
  assert.equal(misAJour.coutTotal, 20);
});
