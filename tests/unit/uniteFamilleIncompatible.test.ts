import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";
import { calculerCoutRecette, UniteIncompatibleError } from "../../server/utils/coutRecette.js";

// Unité d'une ligne de recette d'une autre famille (poids / volume / pièce) que celle du tarif de
// l'ingrédient (constat de l'audit du 15/10, point 3) : 100 g d'œufs vendus 0,30 € la pièce
// coûtaient 30 € (100 « unités » × 0,30 €), et le stock — tenu dans la famille du tarif — était
// déduit d'autant. Décision du 15/10 : une telle ligne est refusée à l'enregistrement, avec un
// message clair ; une recette déjà enregistrée dans ce cas est signalée « coût incalculable » et sa
// production est bloquée jusqu'à correction.

function ligne(uniteLigne: { facteurBase: number; type?: string; symbole?: string }, uniteTarif: { facteurBase: number; type?: string; symbole?: string }) {
  return {
    portions: 1,
    prixVenteHT: null,
    lignes: [
      {
        quantite: 100,
        unite: uniteLigne,
        gainCuissonPct: 0,
        article: {
          nom: "Œufs",
          rendement: 100,
          tarifs: [{ prixHT: 0.3, quantiteConditionnement: 1, unite: uniteTarif }],
          allergenes: [],
          nutrition: null,
        },
      },
    ],
  };
}

const GRAMME = { facteurBase: 1, type: "poids", symbole: "g" };
const KG = { facteurBase: 1000, type: "poids", symbole: "kg" };
const PIECE = { facteurBase: 1, type: "unite", symbole: "pièce" };

test("calcul : une ligne en grammes d'un article vendu à la pièce est refusée, avec l'article et les deux unités", () => {
  assert.throws(
    () => calculerCoutRecette(ligne(GRAMME, PIECE)),
    (erreur: unknown) =>
      erreur instanceof UniteIncompatibleError &&
      /Œufs/.test(erreur.message) &&
      /g/.test(erreur.message) &&
      /pièce/.test(erreur.message)
  );
});

test("calcul : même famille (g pour un tarif au kg) acceptée ; « piece » et « unite » sont la même famille", () => {
  assert.equal(calculerCoutRecette(ligne(GRAMME, { ...KG })).coutTotal, 100 * 0.3 / 1000);
  assert.doesNotThrow(() => calculerCoutRecette(ligne(PIECE, { ...PIECE, type: "piece" })));
});

test("calcul : article sans tarif ou unité sans famille connue : aucun refus (rien à comparer)", () => {
  const sansTarif = ligne(GRAMME, PIECE);
  sansTarif.lignes[0].article.tarifs = [];
  assert.doesNotThrow(() => calculerCoutRecette(sansTarif));
  assert.doesNotThrow(() => calculerCoutRecette(ligne({ facteurBase: 1 }, PIECE)));
});

// --- Parcours réels par l'API (société dédiée) ---

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let oeufsId: number;
let grammeId: number;
let depotId: number;
let recetteHeriteeId: number;
const marqueur = `UNITE-FAMILLE-${randomUUID()}`;

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
  grammeId = (
    (await prisma.unite.findFirst({ where: { symbole: "g" } })) ??
    (await prisma.unite.create({ data: { nom: "Gramme", symbole: "g", type: "poids", facteurBase: 1 } }))
  ).id;
  const pieceId = (
    (await prisma.unite.findFirst({ where: { symbole: "pièce" } })) ??
    (await prisma.unite.create({ data: { nom: "Pièce", symbole: "pièce", type: "unite", facteurBase: 1 } }))
  ).id;
  oeufsId = (
    await prisma.article.create({ data: { nom: `${marqueur} œufs`, type: "MATIERE_PREMIERE", categorieId, tvaId, societeId } })
  ).id;
  await prisma.tarifArticle.create({
    data: { articleId: oeufsId, fournisseurId, uniteId: pieceId, conditionnementId, quantiteConditionnement: 1, prixHT: 0.3, actif: true },
  });
  depotId = (await prisma.depot.create({ data: { nom: marqueur, societeId } })).id;
  await prisma.stock.create({ data: { articleId: oeufsId, depotId, quantite: 1000 } });
  // Recette enregistrée avant ce contrôle : 100 g d'œufs vendus à la pièce.
  recetteHeriteeId = (
    await prisma.recette.create({
      data: { nom: `${marqueur} omelette`, societeId, portions: 1, lignes: { create: [{ articleId: oeufsId, quantite: 100, uniteId: grammeId }] } },
    })
  ).id;
});

after(async () => {
  try {
    await prisma.mouvementStock.deleteMany({ where: { articleId: oeufsId } });
    await prisma.production.deleteMany({ where: { societeId } });
    await prisma.stock.deleteMany({ where: { articleId: oeufsId } });
    await prisma.recetteLigne.deleteMany({ where: { recette: { societeId } } });
    await prisma.recette.deleteMany({ where: { societeId } });
    await prisma.tarifArticle.deleteMany({ where: { articleId: oeufsId } });
    await prisma.article.deleteMany({ where: { societeId } });
    await prisma.depot.deleteMany({ where: { societeId } });
    await prisma.fournisseur.deleteMany({ where: { societeId } });
    await prisma.categorie.deleteMany({ where: { societeId } });
    await prisma.utilisateur.deleteMany({ where: { societeId } });
    await prisma.societe.deleteMany({ where: { id: societeId } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

function appel(method: string, chemin: string, body?: unknown) {
  return fetch(`${baseUrl}/api${chemin}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("API : créer une recette avec 100 g d'œufs vendus à la pièce est refusé (400, message clair), rien n'est créé", async () => {
  const nom = `${marqueur} nouvelle omelette`;
  const reponse = await appel("POST", "/recettes", {
    nom,
    portions: 1,
    lignes: [{ articleId: oeufsId, quantite: 100, uniteId: grammeId }],
    etapes: [],
  });
  assert.equal(reponse.status, 400);
  const { error } = (await reponse.json()) as { error: string };
  assert.match(error, /œufs/);
  assert.match(error, /pièce/);
  assert.equal(await prisma.recette.count({ where: { nom } }), 0);
});

test("API : une recette déjà enregistrée dans ce cas est signalée dans la liste, avec le motif", async () => {
  const reponse = await appel("GET", "/recettes");
  const recettes = (await reponse.json()) as { id: number; calculImpossible?: string }[];
  const heritee = recettes.find((r) => r.id === recetteHeriteeId);
  assert.ok(heritee?.calculImpossible);
  assert.match(heritee.calculImpossible, /pièce/);
});

test("API : sa production est bloquée (400, message clair), sans production ni mouvement de stock", async () => {
  const planif = await appel("POST", "/production/planifier", { recetteId: recetteHeriteeId, cible: { mode: "portions", valeur: 1 } });
  assert.equal(planif.status, 400);
  assert.match(((await planif.json()) as { error: string }).error, /pièce/);

  const production = await appel("POST", "/productions", {
    recetteId: recetteHeriteeId,
    depotId,
    cible: { mode: "portions", valeur: 1 },
  });
  assert.equal(production.status, 400);
  assert.match(((await production.json()) as { error: string }).error, /pièce/);
  assert.equal(await prisma.production.count({ where: { recetteId: recetteHeriteeId } }), 0);
  assert.equal(await prisma.mouvementStock.count({ where: { articleId: oeufsId } }), 0);
  assert.equal((await prisma.stock.findFirstOrThrow({ where: { articleId: oeufsId, depotId } })).quantite, 1000);
});
