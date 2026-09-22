import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import {
  meilleurTarifAlternatif,
  type TarifPourComparaison,
} from "../../server/utils/suggestionsEconomie.js";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Teste server/utils/suggestionsEconomie.ts après le retrait complet de la comparaison
// inter-articles (voir l'audit produit : le module suggérait des remplacements absurdes du type
// « remplacer le poivre blanc par de l'eau », simplement parce que les deux étaient dans la même
// (large) catégorie d'ingrédients et que l'eau était moins chère au litre). La règle métier
// retenue : une différence de catégorie, de prix ou de coût ne constitue jamais à elle seule une
// preuve de substituabilité entre deux Article différents. La seule comparaison désormais possible
// est entre plusieurs tarifs ACTIFS d'un seul et même Article (changer de fournisseur, jamais
// changer d'ingrédient).
//
// Deux niveaux de test :
// - [1] à [8] : tests unitaires purs de meilleurTarifAlternatif() (aucune base de données).
// - [9] à [12] : scénarios réels (vraie app Express, vrai PostgreSQL) prouvant qu'aucune
//   suggestion inter-articles ne peut plus être émise par l'API, y compris sur le cas précis
//   rapporté (poivre blanc / eau), et que les suggestions same-article réelles fonctionnent.

function tarif(overrides: Partial<TarifPourComparaison> = {}): TarifPourComparaison {
  return {
    id: 1,
    prixHT: 65,
    quantiteConditionnement: 10,
    dateDebut: new Date("2024-01-01T00:00:00Z"),
    unite: { facteurBase: 1000, symbole: "kg", type: "poids" },
    fournisseur: { id: 1, nom: "Fournisseur A" },
    conditionnement: { nom: "Carton" },
    ...overrides,
  };
}

test("[7] aucune suggestion si l'article n'a qu'un seul tarif actif", () => {
  assert.equal(meilleurTarifAlternatif([tarif()]), null);
});

test("aucune suggestion si l'article n'a aucun tarif actif", () => {
  assert.equal(meilleurTarifAlternatif([]), null);
});

test("[1] même article, fournisseur actuel plus cher qu'un fournisseur alternatif : suggestion émise", () => {
  const actuel = tarif({
    id: 1,
    dateDebut: new Date("2024-06-01"),
    prixHT: 100,
    quantiteConditionnement: 10,
    fournisseur: { id: 1, nom: "Fournisseur cher" },
  }); // 100 / (10*1000) = 0.01 €/g
  const alternatif = tarif({
    id: 2,
    dateDebut: new Date("2024-01-01"),
    prixHT: 60,
    quantiteConditionnement: 10,
    fournisseur: { id: 2, nom: "Fournisseur moins cher" },
  }); // 60 / (10*1000) = 0.006 €/g -> 40% moins cher

  const resultat = meilleurTarifAlternatif([actuel, alternatif]);
  assert.notEqual(resultat, null);
  assert.equal(resultat?.tarifActuel.id, 1, "le tarif actuel est le plus récent (dateDebut desc)");
  assert.equal(resultat?.tarifAlternatif.id, 2);
  assert.equal(resultat?.prixActuelParUniteBase, 0.01);
  assert.equal(resultat?.prixAlternatifParUniteBase, 0.006);
  assert.ok(Math.abs((resultat?.economiePct ?? 0) - 40) < 1e-9);
});

test("[2] même article, prix identiques : aucune suggestion", () => {
  const actuel = tarif({ id: 1, dateDebut: new Date("2024-06-01"), prixHT: 65, quantiteConditionnement: 10 });
  const identique = tarif({ id: 2, dateDebut: new Date("2024-01-01"), prixHT: 65, quantiteConditionnement: 10 });

  assert.equal(meilleurTarifAlternatif([actuel, identique]), null);
});

test("[3] même article, économie sous le seuil (5% < 10%) : aucune suggestion", () => {
  const actuel = tarif({ id: 1, dateDebut: new Date("2024-06-01"), prixHT: 100, quantiteConditionnement: 10 }); // 0.01 €/g
  const legerementMoinsCher = tarif({ id: 2, dateDebut: new Date("2024-01-01"), prixHT: 95, quantiteConditionnement: 10 }); // 0.0095 €/g -> 5%

  assert.equal(meilleurTarifAlternatif([actuel, legerementMoinsCher]), null);
});

test("[4] même article, économie au-dessus du seuil (20% > 10%) : suggestion émise", () => {
  const actuel = tarif({ id: 1, dateDebut: new Date("2024-06-01"), prixHT: 100, quantiteConditionnement: 10 }); // 0.01 €/g
  const moinsCher = tarif({ id: 2, dateDebut: new Date("2024-01-01"), prixHT: 80, quantiteConditionnement: 10 }); // 0.008 €/g -> 20%

  const resultat = meilleurTarifAlternatif([actuel, moinsCher]);
  assert.notEqual(resultat, null);
  assert.ok(Math.abs((resultat?.economiePct ?? 0) - 20) < 1e-9);
});

test("[5] unités/conditionnements différents pour le même article : comparaison normalisée correcte, pas sur le prix brut du conditionnement", () => {
  // Tarif actuel : carton de 10kg à 65€ -> 0,0065 €/g.
  const actuel = tarif({
    id: 1,
    dateDebut: new Date("2024-06-01"),
    prixHT: 65,
    quantiteConditionnement: 10,
    unite: { facteurBase: 1000, symbole: "kg", type: "poids" },
  });
  // Tarif B : sachet de 0,5kg à seulement 6€ de prix affiché (bien moins cher que 65€ en brut),
  // mais 6 / (0,5*1000) = 0,012 €/g -> en réalité PLUS CHER au gramme que le tarif actuel.
  const brutMoinsCherMaisReellementPlusCher = tarif({
    id: 2,
    dateDebut: new Date("2024-01-01"),
    prixHT: 6,
    quantiteConditionnement: 0.5,
    unite: { facteurBase: 1000, symbole: "kg", type: "poids" },
    fournisseur: { id: 2, nom: "Sachet cher au gramme" },
  });

  assert.equal(
    meilleurTarifAlternatif([actuel, brutMoinsCherMaisReellementPlusCher]),
    null,
    "un prix affiché plus bas (6€ vs 65€) ne doit jamais suffire : ramené au gramme il est plus cher, donc aucune suggestion"
  );

  // Tarif C : sac de 1kg à 3€ -> 3 / (1*1000) = 0,003 €/g -> réellement moins cher (54%).
  const reellementMoinsCher = tarif({
    id: 3,
    dateDebut: new Date("2023-01-01"),
    prixHT: 3,
    quantiteConditionnement: 1,
    unite: { facteurBase: 1000, symbole: "kg", type: "poids" },
    fournisseur: { id: 3, nom: "Vrai moins cher au gramme" },
  });

  const resultat = meilleurTarifAlternatif([actuel, brutMoinsCherMaisReellementPlusCher, reellementMoinsCher]);
  assert.notEqual(resultat, null);
  assert.equal(resultat?.tarifAlternatif.id, 3, "doit sélectionner le tarif réellement le moins cher au gramme, pas celui au prix affiché le plus bas");
  assert.equal(resultat?.prixAlternatifParUniteBase, 0.003);
});

test("[6] plusieurs fournisseurs/tarifs (4) : sélectionne le tarif réellement le moins cher, pas le premier moins cher rencontré", () => {
  const actuel = tarif({ id: 1, dateDebut: new Date("2024-06-01"), prixHT: 100, quantiteConditionnement: 10 }); // 0.01 €/g
  const moinsCher1 = tarif({ id: 2, dateDebut: new Date("2024-05-01"), prixHT: 80, quantiteConditionnement: 10, fournisseur: { id: 2, nom: "B" } }); // 0.008 €/g
  const bienMoinsCher = tarif({ id: 3, dateDebut: new Date("2024-04-01"), prixHT: 50, quantiteConditionnement: 10, fournisseur: { id: 3, nom: "C, le vrai gagnant" } }); // 0.005 €/g
  const intermediaire = tarif({ id: 4, dateDebut: new Date("2024-03-01"), prixHT: 90, quantiteConditionnement: 10, fournisseur: { id: 4, nom: "D" } }); // 0.009 €/g

  const resultat = meilleurTarifAlternatif([actuel, moinsCher1, bienMoinsCher, intermediaire]);
  assert.notEqual(resultat, null);
  assert.equal(resultat?.tarifAlternatif.id, 3, "doit choisir le minimum global (0.005 €/g), pas moinsCher1 (0.008) rencontré en premier dans la liste");
});

test("[8] un tarif candidat aux données invalides est ignoré sans empêcher la comparaison des autres", () => {
  const actuel = tarif({ id: 1, dateDebut: new Date("2024-06-01"), prixHT: 100, quantiteConditionnement: 10 }); // 0.01 €/g
  const invalide = tarif({ id: 2, dateDebut: new Date("2024-05-01"), prixHT: -50, quantiteConditionnement: 10, fournisseur: { id: 2, nom: "Données corrompues" } }); // prixHT négatif -> prixParUniteBase lève
  const valideMoinsCher = tarif({ id: 3, dateDebut: new Date("2024-04-01"), prixHT: 70, quantiteConditionnement: 10, fournisseur: { id: 3, nom: "Valide" } }); // 0.007 €/g -> 30%

  const resultat = meilleurTarifAlternatif([actuel, invalide, valideMoinsCher]);
  assert.notEqual(resultat, null);
  assert.equal(resultat?.tarifAlternatif.id, 3);
});

test("le tarif actuel lui-même aux données invalides : aucune suggestion (pas de base fiable pour comparer)", () => {
  const actuelInvalide = tarif({ id: 1, dateDebut: new Date("2024-06-01"), prixHT: -10, quantiteConditionnement: 10 });
  const autre = tarif({ id: 2, dateDebut: new Date("2024-01-01"), prixHT: 50, quantiteConditionnement: 10 });

  assert.equal(meilleurTarifAlternatif([actuelInvalide, autre]), null);
});

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurAId: number;
let fournisseurBId: number;
let conditionnementId: number;
let uniteKgId: number;
const recetteIds: number[] = [];
const articleIds: number[] = [];
const tarifIds: number[] = [];

async function creerRecette(body: unknown): Promise<{ id: number }> {
  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const texte = await reponse.text();
  assert.equal(reponse.status, 201, `Création de recette échouée : ${texte}`);
  const recette = JSON.parse(texte);
  recetteIds.push(recette.id);
  return recette;
}

async function creerArticle(nom: string, reference: string): Promise<number> {
  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom, reference, categorieId, tvaId, societeId, rendement: 100, actif: true },
  });
  articleIds.push(article.id);
  return article.id;
}

async function creerTarif(
  articleId: number,
  fournisseurId: number,
  prixHT: number,
  quantiteConditionnement: number,
  dateDebut: Date
): Promise<number> {
  const tarifCree = await prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId: uniteKgId, conditionnementId, quantiteConditionnement, prixHT, actif: true, dateDebut },
  });
  tarifIds.push(tarifCree.id);
  return tarifCree.id;
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

  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }
  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: "admin", code: "1234" }),
  });
  assert.equal(reponseLogin.status, 200, "Connexion admin/1234 impossible");
  token = (await reponseLogin.json()).token;

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  // Une seule et même (large) catégorie pour tous les articles de ce fichier de test : c'est
  // exactement le scénario qui produisait l'ancien bug (deux articles très différents dans la
  // même catégorie d'ingrédients) — sert à prouver que la catégorie n'a plus aucune influence.
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const fournisseurA = await prisma.fournisseur.create({ data: { nom: "SUGGECO TEST Fournisseur A", societeId } });
  fournisseurAId = fournisseurA.id;
  const fournisseurB = await prisma.fournisseur.create({ data: { nom: "SUGGECO TEST Fournisseur B", societeId } });
  fournisseurBId = fournisseurB.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));
  conditionnementId = conditionnement.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;
});

after(async () => {
  await prisma.tarifArticle.deleteMany({ where: { id: { in: tarifIds } } });
  await prisma.recetteLigne.deleteMany({ where: { recetteId: { in: recetteIds } } });
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.fournisseur.deleteMany({ where: { id: { in: [fournisseurAId, fournisseurBId] } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("[9] deux articles différents dans la même catégorie, l'un bien moins cher que l'autre : JAMAIS de suggestion inter-articles", async () => {
  const articleCherId = await creerArticle("SUGGECO TEST Article cher", "SUGGECO-CHER");
  const articleBonMarcheId = await creerArticle("SUGGECO TEST Article bon marché", "SUGGECO-BONMARCHE");
  // Même catégorie que articleCherId (categorieId partagé par tous les articles de ce fichier).
  await creerTarif(articleCherId, fournisseurAId, 100, 10, new Date("2024-01-01")); // 0.01 €/g
  await creerTarif(articleBonMarcheId, fournisseurBId, 1, 10, new Date("2024-01-01")); // 0.0001 €/g : 100x moins cher

  const recette = await creerRecette({
    societeId,
    nom: "SUGGECO TEST Recette article cher seul",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId: articleCherId, quantite: 100, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [],
  });

  const reponse = await fetch(`${baseUrl}/api/recettes/${recette.id}/suggestions-economie`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(reponse.status, 200);
  const suggestions = await reponse.json();

  assert.deepEqual(
    suggestions,
    [],
    "articleCherId n'a qu'un seul tarif actif : aucune suggestion ne doit jamais apparaître, même si un autre article bien moins cher existe dans la même catégorie"
  );
});

test("[10] scénario exact rapporté : poivre blanc + eau dans la même catégorie : JAMAIS de suggestion « remplacer par eau »", async () => {
  const poivreId = await creerArticle("SUGGECO TEST Poivre blanc", "SUGGECO-POIVRE");
  const eauId = await creerArticle("SUGGECO TEST Eau", "SUGGECO-EAU");
  await creerTarif(poivreId, fournisseurAId, 40, 1, new Date("2024-06-01")); // 40 €/kg, un seul tarif (le plus récent)
  await creerTarif(eauId, fournisseurBId, 0.5, 10, new Date("2024-01-01")); // quasi gratuite

  const recette = await creerRecette({
    societeId,
    nom: "SUGGECO TEST Recette au poivre blanc",
    categorieId: null,
    sousCategorieId: null,
    portions: 4,
    lignes: [{ articleId: poivreId, quantite: 10, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [],
  });

  const reponse = await fetch(`${baseUrl}/api/recettes/${recette.id}/suggestions-economie`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(reponse.status, 200);
  const suggestions = await reponse.json();

  assert.deepEqual(suggestions, [], "un seul tarif pour le poivre blanc : aucune suggestion, et surtout jamais 'eau' comme alternative");

  // Preuve renforcée : même en donnant au poivre blanc un second tarif RÉELLEMENT moins cher
  // mais plus ANCIEN (toujours actif : fournisseurA, le plus récent, reste "actuel", et ce
  // second tarif, moins cher, devient l'alternative), la suggestion émise doit toujours parler
  // de poivre blanc des deux côtés, jamais d'eau.
  await creerTarif(poivreId, fournisseurBId, 25, 1, new Date("2024-01-01")); // 25 €/kg, plus ancien mais moins cher : 37.5%

  const reponse2 = await fetch(`${baseUrl}/api/recettes/${recette.id}/suggestions-economie`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const suggestions2 = await reponse2.json();
  assert.equal(suggestions2.length, 1);
  assert.equal(suggestions2[0].article.nom, "SUGGECO TEST Poivre blanc");
  assert.equal(suggestions2[0].fournisseurActuel.nom, "SUGGECO TEST Fournisseur A");
  assert.equal(suggestions2[0].fournisseurAlternatif.nom, "SUGGECO TEST Fournisseur B");
  // L'article suggéré est toujours le poivre blanc lui-même (changement de fournisseur), jamais
  // l'eau — même si elle est présente dans la même catégorie et bien moins chère.
  assert.equal(suggestions2[0].article.id, poivreId);
  assert.notEqual(suggestions2[0].article.id, eauId);
});

test("[11] même article réel, deux fournisseurs actifs : suggestion complète avec tous les champs requis, économie calculée sur le prix ramené à l'unité de base", async () => {
  const farineId = await creerArticle("SUGGECO TEST Farine", "SUGGECO-FARINE");
  await creerTarif(farineId, fournisseurAId, 20, 10, new Date("2024-01-01")); // 20€ / 10kg = 2 €/kg = 0.002 €/g (actuel, plus récent)
  await creerTarif(farineId, fournisseurBId, 12, 10, new Date("2023-01-01")); // 12€ / 10kg = 1.2 €/kg = 0.0012 €/g -> 40% moins cher

  const recette = await creerRecette({
    societeId,
    nom: "SUGGECO TEST Recette farine multi-fournisseurs",
    categorieId: null,
    sousCategorieId: null,
    portions: 2,
    prixVenteHT: 10,
    lignes: [{ articleId: farineId, quantite: 2, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [],
  });

  const reponse = await fetch(`${baseUrl}/api/recettes/${recette.id}/suggestions-economie`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(reponse.status, 200);
  const suggestions = await reponse.json();

  assert.equal(suggestions.length, 1);
  const suggestion = suggestions[0];

  assert.equal(suggestion.article.nom, "SUGGECO TEST Farine");
  assert.equal(suggestion.fournisseurActuel.nom, "SUGGECO TEST Fournisseur A");
  assert.equal(suggestion.fournisseurAlternatif.nom, "SUGGECO TEST Fournisseur B");
  assert.equal(suggestion.prixActuelParUniteBase, 0.002);
  assert.equal(suggestion.prixAlternatifParUniteBase, 0.0012);
  assert.equal(suggestion.uniteBase, "g");
  assert.equal(suggestion.conditionnementActuel.quantiteConditionnement, 10);
  assert.equal(suggestion.conditionnementAlternatif.quantiteConditionnement, 10);
  assert.ok(Math.abs(suggestion.economiePct - 40) < 1e-6);
  // 2kg = 2000g utilisés dans la recette ; économie = 2000 * (0.002 - 0.0012) / (rendement 100% => /1) = 1.6 €
  assert.ok(Math.abs(suggestion.economieEuros - 1.6) < 1e-9, "l'économie en € doit être calculée sur le prix ramené à l'unité de base, pas sur le prix brut du conditionnement (20€ vs 12€ donnerait un tout autre résultat)");
  assert.notEqual(suggestion.nouveauFoodCostPct, null);
});

test("[12] plusieurs lignes de recette référençant des articles différents : chaque ligne évaluée indépendamment, aucune contamination entre lignes", async () => {
  const article1Id = await creerArticle("SUGGECO TEST Ligne1", "SUGGECO-L1");
  const article2Id = await creerArticle("SUGGECO TEST Ligne2 (un seul tarif)", "SUGGECO-L2");
  await creerTarif(article1Id, fournisseurAId, 50, 10, new Date("2024-06-01")); // actuel
  await creerTarif(article1Id, fournisseurBId, 30, 10, new Date("2024-01-01")); // 40% moins cher
  await creerTarif(article2Id, fournisseurAId, 15, 10, new Date("2024-01-01")); // un seul tarif : pas de suggestion possible

  const recette = await creerRecette({
    societeId,
    nom: "SUGGECO TEST Recette deux lignes",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [
      { articleId: article1Id, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 },
      { articleId: article2Id, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 },
    ],
    etapes: [],
  });

  const reponse = await fetch(`${baseUrl}/api/recettes/${recette.id}/suggestions-economie`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const suggestions = await reponse.json();

  assert.equal(suggestions.length, 1, "seule la ligne article1 (2 tarifs) doit produire une suggestion, jamais article2 (1 seul tarif)");
  assert.equal(suggestions[0].article.nom, "SUGGECO TEST Ligne1");
});
