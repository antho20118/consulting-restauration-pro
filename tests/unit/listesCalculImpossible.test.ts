import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Recette dont le coût ne peut pas être calculé (constat de l'audit du 15/10, point 11) : elle
// disparaissait sans aucun message de la liste des recettes, du tableau de bord, et entraînait avec
// elle tout menu qui la contient ; sa fiche répondait 500. L'API refuse aujourd'hui de créer une
// telle recette (calcul validé dans la transaction de création), mais des recettes enregistrées
// avant ce contrôle existent encore (ex. 0 portion, cas cité dans server/routes/recettes.ts) :
// reproduites ici directement en base. Société dédiée à ce fichier.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let recetteValideId: number;
let recetteInvalideId: number;
let menuAvecInvalideId: number;
let menuValideId: number;
let allergeneId: number;
const marqueur = `CALCUL-IMPOSSIBLE-${randomUUID()}`;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  societeId = (await prisma.societe.create({ data: { nom: marqueur } })).id;
  await prisma.utilisateur.create({
    data: { identifiant: marqueur, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId },
  });
  const connexion = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: marqueur, code: "1234" }),
  });
  token = ((await connexion.json()) as { token: string }).token;

  const categorieId = (await prisma.categorie.create({ data: { nom: marqueur, societeId } })).id;
  const tvaId = (await prisma.tVA.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
  const fournisseurId = (
    await prisma.fournisseur.create({ data: { nom: marqueur, societeId, codeFournisseur: "FOU-TEST" } })
  ).id;
  const conditionnementId = (
    (await prisma.conditionnement.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.conditionnement.create({ data: { nom: "Unité" } }))
  ).id;
  const uniteGramme =
    (await prisma.unite.findFirst({ where: { symbole: "g" } })) ??
    (await prisma.unite.create({ data: { nom: "Gramme", symbole: "g", type: "poids", facteurBase: 1 } }));
  allergeneId = (await prisma.allergene.create({ data: { nom: `${marqueur} gluten`, code: marqueur } })).id;

  const article = await prisma.article.create({
    data: {
      nom: `${marqueur} farine`,
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      allergenes: { create: [{ allergeneId }] },
    },
  });
  await prisma.tarifArticle.create({
    data: { articleId: article.id, fournisseurId, uniteId: uniteGramme.id, conditionnementId, quantiteConditionnement: 1, prixHT: 0.002, actif: true },
  });
  const ligne = { articleId: article.id, quantite: 500, uniteId: uniteGramme.id };
  recetteValideId = (
    await prisma.recette.create({ data: { nom: `${marqueur} pain`, societeId, portions: 4, prixVenteHT: 5, lignes: { create: [ligne] } } })
  ).id;
  // Recette héritée : 0 portion, valeur refusée aujourd'hui à la création mais présente en base.
  recetteInvalideId = (
    await prisma.recette.create({ data: { nom: `${marqueur} brioche`, societeId, portions: 0, lignes: { create: [ligne] } } })
  ).id;
  menuValideId = (
    await prisma.menu.create({ data: { nom: `${marqueur} menu pain`, societeId, lignes: { create: [{ recetteId: recetteValideId }] } } })
  ).id;
  menuAvecInvalideId = (
    await prisma.menu.create({
      data: { nom: `${marqueur} menu brioche`, societeId, lignes: { create: [{ recetteId: recetteValideId }, { recetteId: recetteInvalideId }] } },
    })
  ).id;
});

after(async () => {
  try {
    await prisma.menuLigne.deleteMany({ where: { menuId: { in: [menuValideId, menuAvecInvalideId] } } });
    await prisma.menu.deleteMany({ where: { societeId } });
    await prisma.recetteLigne.deleteMany({ where: { recette: { societeId } } });
    await prisma.recette.deleteMany({ where: { societeId } });
    const articles = await prisma.article.findMany({ where: { societeId }, select: { id: true } });
    const ids = articles.map((a) => a.id);
    await prisma.articleAllergene.deleteMany({ where: { articleId: { in: ids } } });
    await prisma.tarifArticle.deleteMany({ where: { articleId: { in: ids } } });
    await prisma.article.deleteMany({ where: { id: { in: ids } } });
    await prisma.allergene.deleteMany({ where: { id: allergeneId } });
    await prisma.fournisseur.deleteMany({ where: { societeId } });
    await prisma.categorie.deleteMany({ where: { societeId } });
    await prisma.utilisateur.deleteMany({ where: { societeId } });
    await prisma.societe.deleteMany({ where: { id: societeId } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

async function lire(chemin: string) {
  const reponse = await fetch(`${baseUrl}/api${chemin}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: reponse.status, corps: (await reponse.json()) as Record<string, unknown> & Record<string, unknown>[] };
}

type RecetteListe = { id: number; calculImpossible?: string; allergenes: { id: number }[]; coutParPortion: number };

test("la liste des recettes garde une recette au calcul impossible, signalée, avec ses allergènes", async () => {
  const { status, corps } = await lire("/recettes");
  assert.equal(status, 200);
  const recettes = corps as unknown as RecetteListe[];
  const invalide = recettes.find((r) => r.id === recetteInvalideId);
  assert.ok(invalide, "la recette ne doit jamais disparaître de la liste");
  assert.ok(invalide.calculImpossible, "la recette doit être signalée");
  assert.ok(
    invalide.allergenes.some((a) => a.id === allergeneId),
    "les allergènes de ses ingrédients restent affichés (information de sécurité)"
  );
  const valide = recettes.find((r) => r.id === recetteValideId);
  assert.ok(valide);
  assert.equal(valide.calculImpossible, undefined, "une recette normale n'est jamais signalée");
  assert.equal(valide.coutParPortion, 0.25);
});

test("la fiche d'une recette au calcul impossible s'ouvre (pour pouvoir la corriger) au lieu d'une erreur 500", async () => {
  const { status, corps } = await lire(`/recettes/${recetteInvalideId}`);
  assert.equal(status, 200);
  assert.ok(corps.calculImpossible);
});

test("un menu contenant une recette au calcul impossible reste dans la liste, signalé", async () => {
  const { status, corps } = await lire("/menus");
  assert.equal(status, 200);
  const menus = corps as unknown as { id: number; calculImpossible?: string }[];
  const avecInvalide = menus.find((m) => m.id === menuAvecInvalideId);
  assert.ok(avecInvalide, "le menu ne doit jamais disparaître de la liste");
  assert.ok(avecInvalide.calculImpossible);
  const valide = menus.find((m) => m.id === menuValideId);
  assert.ok(valide);
  assert.equal(valide.calculImpossible, undefined);
});

test("le tableau de bord compte la recette, sans fausser le food cost moyen", async () => {
  const { status, corps } = await lire("/dashboard");
  assert.equal(status, 200);
  assert.equal(corps.nbRecettes, 2);
  // Seule la recette calculable entre dans la moyenne : 0,25 € / 5 € = 5 %.
  assert.ok(Math.abs((corps.foodCostMoyen as number) - 5) < 1e-9);
});
