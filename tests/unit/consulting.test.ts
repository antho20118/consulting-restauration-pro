import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre POST /api/consulting/analyser-recette (app Express réelle,
// Postgres configuré par DATABASE_URL). Voir tests/unit/production.test.ts pour le même principe
// appliqué à un autre endpoint.
//
// Rappel important (voir le rapport d'audit) : cet endpoint est une analyse déterministe pure —
// aucun appel à un modèle de langage. Ces tests vérifient donc uniquement les indicateurs calculés
// et les alertes générées à partir des règles en dur (coutRecette.ts, haccp.ts), pas une capacité
// de "recommandation" ou de "simulation" au sens agent IA : ces capacités ne sont pas implémentées
// par cette route.

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
let articleAvecTarifId: number;
let articleSansTarifId: number;
const recetteIds: number[] = [];

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

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "Fournisseur test consulting", societeId } });
  fournisseurId = fournisseur.id;

  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));
  conditionnementId = conditionnement.id;

  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;

  // Article avec un tarif actif : 50€ pour 1kg (conditionnement de 1) → 0,05€/g, rendement 100%.
  const articleAvecTarif = await prisma.article.create({
    data: {
      nom: "CONSULTING TEST ARTICLE AVEC TARIF",
      reference: "TESTCONSULTING-AVEC-TARIF",
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      actif: true,
    },
  });
  articleAvecTarifId = articleAvecTarif.id;
  await prisma.tarifArticle.create({
    data: {
      articleId: articleAvecTarifId,
      fournisseurId,
      uniteId: uniteKgId,
      conditionnementId,
      quantiteConditionnement: 1,
      prixHT: 50,
      actif: true,
    },
  });

  // Article sans aucun tarif actif : sert à provoquer l'alerte "tarif manquant" / "coût nul".
  const articleSansTarif = await prisma.article.create({
    data: {
      nom: "CONSULTING TEST ARTICLE SANS TARIF",
      reference: "TESTCONSULTING-SANS-TARIF",
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      actif: true,
    },
  });
  articleSansTarifId = articleSansTarif.id;
});

after(async () => {
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  await prisma.tarifArticle.deleteMany({ where: { articleId: articleAvecTarifId } });
  await prisma.article.deleteMany({ where: { id: { in: [articleAvecTarifId, articleSansTarifId] } } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("relève les 4 alertes attendues : coût nul, tarif manquant, HACCP à valider, food cost non évaluable sans prix de vente", async () => {
  const recette = await creerRecette({
    nom: "CONSULTING TEST recette 3 alertes",
    societeId,
    categorieId: categorieRecetteId,
    portions: 4,
    lignes: [{ articleId: articleSansTarifId, quantite: 1, uniteId: uniteKgId }],
    etapes: [{ description: "Cuisson du plat au four", pointCritiqueHACCP: true, controleHACCP: null }],
  });

  const reponse = await fetch(`${baseUrl}/api/consulting/analyser-recette`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.indicateurs.coutTotal, 0);
  assert.equal(resultat.indicateurs.coutParPortion, 0);
  assert.equal(resultat.indicateurs.foodCostPct, null);
  assert.deepEqual(
    [...resultat.alertes].sort(),
    [
      "Au moins un ingrédient n'a pas de tarif actif",
      "Coût matière nul ou non tarifé",
      "Des étapes nécessitent une validation HACCP",
      "Food cost non évaluable : prix de vente non renseigné et aucun coefficient multiplicateur configuré (voir Paramètres)",
    ].sort()
  );
  assert.equal(resultat.simulation, null);
  assert.equal(resultat.haccp.length, 1);
  assert.equal(resultat.haccp[0].aValider, true);
  assert.ok(resultat.haccp[0].reglesDetectees.some((r: { code: string }) => r.code === "CUISSON"));
});

// Constat A3 de l'audit fonctionnel de l'agent Consulting : un coût matière élevé sans prix de
// vente renseigné ne déclenchait auparavant AUCUNE alerte (foodCostPct null neutralisait
// silencieusement la seule règle liée au coût) — indiscernable d'une recette réellement saine.
// Isolé ici sur une recette par ailleurs propre (article tarifé, pas d'étape HACCP) pour ne
// vérifier que ce point précis.
test("A3 : un coût matière élevé SANS prix de vente déclenche 'food cost non évaluable', jamais un silence total", async () => {
  const recette = await creerRecette({
    nom: "CONSULTING TEST A3 cout eleve sans prix de vente",
    societeId,
    categorieId: categorieRecetteId,
    portions: 1,
    // Pas de prixVenteHT : c'est précisément le cas que l'audit a trouvé silencieux.
    lignes: [{ articleId: articleAvecTarifId, quantite: 1, uniteId: uniteKgId }],
    etapes: [{ description: "Dresser l'assiette", pointCritiqueHACCP: false, controleHACCP: null }],
  });

  const reponse = await fetch(`${baseUrl}/api/consulting/analyser-recette`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.indicateurs.coutParPortion, 50, "coût matière réellement élevé (50€/portion)");
  assert.equal(resultat.indicateurs.foodCostPct, null);
  assert.deepEqual(resultat.alertes, [
    "Food cost non évaluable : prix de vente non renseigné et aucun coefficient multiplicateur configuré (voir Paramètres)",
  ]);
  assert.equal(resultat.simulation, null);
});

// Suite du constat A3 : une fois qu'un coefficient multiplicateur est configuré pour la société,
// une recette sans prix de vente réel n'est plus "non évaluable" du tout — elle obtient une
// simulation explicite (prix estimé + food cost théorique), jamais une alerte (ce n'est pas un
// problème, c'est une information). Coefficient restauré à sa valeur d'origine (null, partagée
// avec les autres fichiers de test) dans un `finally`, pour ne jamais laisser fuiter cet état.
test("A3 (suite) : coefficient configuré -> simulation de prix explicite, aucune alerte food cost", async () => {
  const societeAvant = await prisma.societe.findUniqueOrThrow({ where: { id: societeId } });
  await prisma.societe.update({ where: { id: societeId }, data: { coefficientMultiplicateur: 4 } });

  try {
    const recette = await creerRecette({
      nom: "CONSULTING TEST A3 coefficient configure",
      societeId,
      categorieId: categorieRecetteId,
      portions: 1,
      lignes: [{ articleId: articleAvecTarifId, quantite: 1, uniteId: uniteKgId }],
      etapes: [{ description: "Dresser l'assiette", pointCritiqueHACCP: false, controleHACCP: null }],
    });

    const reponse = await fetch(`${baseUrl}/api/consulting/analyser-recette`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ recetteId: recette.id }),
    });
    assert.equal(reponse.status, 200);
    const resultat = await reponse.json();

    assert.equal(resultat.indicateurs.coutParPortion, 50);
    assert.equal(resultat.indicateurs.foodCostPct, null, "toujours null : pas de vrai prix de vente");
    assert.deepEqual(resultat.simulation, {
      coefficient: 4,
      prixVenteEstimeHT: 200, // 50€ × 4
      foodCostTheoriquePct: 25, // 100 / 4
    });
    assert.equal(resultat.alertes.length, 0, "aucune alerte : une simulation n'est pas un problème");
  } finally {
    await prisma.societe.update({
      where: { id: societeId },
      data: { coefficientMultiplicateur: societeAvant.coefficientMultiplicateur },
    });
  }
});

test("relève l'alerte food cost critique (> 35 %) quand le coût matière est élevé par rapport au prix de vente", async () => {
  // 1kg à 0,05€/g = 50€ de coût matière pour 1 portion, prix de vente 100€ HT → food cost 50 %.
  const recette = await creerRecette({
    nom: "CONSULTING TEST recette food cost eleve",
    societeId,
    categorieId: categorieRecetteId,
    portions: 1,
    prixVenteHT: 100,
    lignes: [{ articleId: articleAvecTarifId, quantite: 1, uniteId: uniteKgId }],
    etapes: [{ description: "Dresser l'assiette", pointCritiqueHACCP: false, controleHACCP: null }],
  });

  const reponse = await fetch(`${baseUrl}/api/consulting/analyser-recette`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.indicateurs.coutParPortion, 50);
  assert.equal(resultat.indicateurs.foodCostPct, 50);
  assert.deepEqual(resultat.alertes, ["Food cost critique : supérieur à 35 %"]);
  assert.equal(resultat.simulation, null, "prix de vente réel renseigné : jamais de simulation");
});

// Cohérence de règle métier trouvée en revue après la fusion de PR #66 : le tableau de bord
// (src/features/dashboard/utils/statutFoodCost.ts, server/routes/dashboard.ts) définit trois
// paliers — Bon (≤28 %), À surveiller (28-35 %), Critique (>35 %) — mais Consulting n'alertait
// jusqu'ici qu'au palier Critique, laissant le palier "À surveiller" invisible sur la fiche recette
// alors qu'il est affiché en orange ailleurs dans l'application pour la même donnée. Vérifie que
// Consulting relève désormais ce palier intermédiaire, avec un libellé distinct du palier critique
// (voir server/utils/seuilsFoodCost.ts).
test("relève l'alerte food cost à surveiller (entre 28 % et 35 %), distincte de l'alerte critique", async () => {
  // 0,6kg à 50€/kg = 30€ de coût matière pour 1 portion, prix de vente 100€ HT → food cost 30 %
  // (dans l'intervalle 28-35 %, palier "à surveiller").
  const recette = await creerRecette({
    nom: "CONSULTING TEST recette food cost a surveiller",
    societeId,
    categorieId: categorieRecetteId,
    portions: 1,
    prixVenteHT: 100,
    lignes: [{ articleId: articleAvecTarifId, quantite: 0.6, uniteId: uniteKgId }],
    etapes: [{ description: "Dresser l'assiette", pointCritiqueHACCP: false, controleHACCP: null }],
  });

  const reponse = await fetch(`${baseUrl}/api/consulting/analyser-recette`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.indicateurs.coutParPortion, 30);
  assert.equal(resultat.indicateurs.foodCostPct, 30);
  assert.deepEqual(resultat.alertes, ["Food cost à surveiller : compris entre 28 % et 35 %"]);
  assert.notEqual(
    resultat.alertes[0],
    "Food cost critique : supérieur à 35 %",
    "le libellé doit rester distinct de l'alerte critique"
  );
  assert.equal(resultat.simulation, null, "prix de vente réel renseigné : jamais de simulation");
});

test("ne relève aucune alerte pour une recette correctement tarifée, au food cost maîtrisé et à l'étape HACCP déjà contrôlée", async () => {
  const recette = await creerRecette({
    nom: "CONSULTING TEST recette sans alerte",
    societeId,
    categorieId: categorieRecetteId,
    portions: 10,
    prixVenteHT: 100,
    lignes: [{ articleId: articleAvecTarifId, quantite: 1, uniteId: uniteKgId }],
    etapes: [{ description: "Cuisson du plat au four", pointCritiqueHACCP: true, controleHACCP: "Sonde à cœur, 75°C minimum" }],
  });

  const reponse = await fetch(`${baseUrl}/api/consulting/analyser-recette`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.deepEqual(resultat.alertes, []);
  assert.equal(resultat.haccp[0].aValider, false);
});

test("ne modifie jamais la recette analysée (endpoint strictement en lecture)", async () => {
  const recette = await creerRecette({
    nom: "CONSULTING TEST recette non-mutation",
    societeId,
    categorieId: categorieRecetteId,
    portions: 2,
    lignes: [{ articleId: articleAvecTarifId, quantite: 1, uniteId: uniteKgId }],
    etapes: [{ description: "Dresser l'assiette", pointCritiqueHACCP: false, controleHACCP: null }],
  });

  const avant = await (await fetch(`${baseUrl}/api/recettes/${recette.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();

  const reponse = await fetch(`${baseUrl}/api/consulting/analyser-recette`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id }),
  });
  assert.equal(reponse.status, 200);

  const apres = await (await fetch(`${baseUrl}/api/recettes/${recette.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();

  assert.deepEqual(avant, apres);
});

test("refuse un recetteId invalide (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/consulting/analyser-recette`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: -1 }),
  });
  assert.equal(reponse.status, 400);
});

test("signale une recette inexistante (404)", async () => {
  const reponse = await fetch(`${baseUrl}/api/consulting/analyser-recette`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: 999999999 }),
  });
  assert.equal(reponse.status, 404);
});
