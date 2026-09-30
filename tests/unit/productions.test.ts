import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Test d'intégration réel contre POST/GET /api/productions (Phase 2 du plan d'action :
// traçabilité HACCP datée, liée à un lot réellement produit — voir la discussion de cadrage : un
// contrôle HACCP réel s'ancre sur « quel lot, quel jour », jamais sur la seule procédure décrite
// sur la recette). Mêmes fixtures/conventions que tests/unit/commandes.test.ts et
// tests/unit/production.test.ts (source unique planifierProduction.ts, jamais réimplémentée ici).

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteKgId: number;
let depotId: number;
let articleId: number;
let recetteId: number;
let etapeCuissonId: number;
let etapeLegumesId: number;
let etapeDresserId: number;
let etapeAutreId: number;
const productionIds: number[] = [];
const recetteIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function creerRecette(body: unknown): Promise<{ id: number; etapes: { id: number; description: string }[] }> {
  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
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

  token = await connecterAdminDeTest(baseUrl);

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie =
    (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;

  const depot =
    (await prisma.depot.findFirst({ where: { societeId } })) ??
    (await prisma.depot.create({ data: { nom: "PRODUCTIONS TEST Dépôt", societeId } }));
  depotId = depot.id;

  const article = await prisma.article.create({
    data: { nom: "PRODUCTIONS TEST Article", type: "MATIERE_PREMIERE", categorieId, tvaId, societeId, actif: true },
  });
  articleId = article.id;

  // Trois étapes : une détectée automatiquement par mots-clés (cuisson), une déclarée point
  // critique manuellement sans mot-clé détectable, une ni l'un ni l'autre (jamais critique).
  const recette = await creerRecette({
    societeId,
    nom: "PRODUCTIONS TEST Recette",
    categorieId: null,
    sousCategorieId: null,
    portions: 4,
    lignes: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [
      { description: "Cuire à 220°C au four", pointCritiqueHACCP: false, controleHACCP: null },
      { description: "Découper les légumes", pointCritiqueHACCP: true, controleHACCP: "Vérifier la propreté du matériel" },
      { description: "Dresser l'assiette", pointCritiqueHACCP: false, controleHACCP: null },
    ],
  });
  recetteId = recette.id;
  etapeCuissonId = recette.etapes.find((e) => e.description.includes("Cuire"))!.id;
  etapeLegumesId = recette.etapes.find((e) => e.description.includes("légumes"))!.id;
  etapeDresserId = recette.etapes.find((e) => e.description.includes("Dresser"))!.id;

  const recetteAutre = await creerRecette({
    societeId,
    nom: "PRODUCTIONS TEST Autre recette",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [{ description: "Cuire à 200°C", pointCritiqueHACCP: false, controleHACCP: null }],
  });
  etapeAutreId = recetteAutre.etapes[0].id;
});

after(async () => {
  await prisma.controleHACCPProduction.deleteMany({ where: { productionId: { in: productionIds } } });
  await prisma.production.deleteMany({ where: { id: { in: productionIds } } });
  await prisma.recetteLigne.deleteMany({ where: { recetteId: { in: recetteIds } } });
  await prisma.recetteEtape.deleteMany({ where: { recetteId: { in: recetteIds } } });
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  await prisma.article.deleteMany({ where: { id: articleId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("POST /productions : enregistre une production réelle, quantités recalculées côté serveur (échelle 10 : 4→40 portions), 2 points critiques identifiés (cuisson détectée + légumes déclaré), jamais « dresser »", async () => {
  const reponse = await fetch(`${baseUrl}/api/productions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recetteId, depotId, cible: { mode: "portions", valeur: 40 } }),
  });
  const texte = await reponse.text();
  assert.equal(reponse.status, 201, texte);
  const production = JSON.parse(texte);
  productionIds.push(production.id);

  assert.equal(production.recetteId, recetteId);
  assert.equal(production.recette.nom, "PRODUCTIONS TEST Recette");
  assert.equal(production.depotId, depotId);
  assert.equal(production.portionsProduites, 40);
  // 1kg par portion de base (portions=4) → échelle 10 → 10kg = 10000g par portion de base, total
  // poidsFiniProduitG dérivé de poidsFiniCibleG (voir planifierProduction.ts).
  assert.ok(production.poidsFiniProduitG > 0);
  assert.ok(production.dateProduction);
  assert.deepEqual(production.controles, []);

  assert.equal(production.etapesCritiques.length, 2);
  const idsCritiques = production.etapesCritiques.map((e: { id: number }) => e.id).sort();
  assert.deepEqual(idsCritiques, [etapeCuissonId, etapeLegumesId].sort());

  const etapeCuisson = production.etapesCritiques.find((e: { id: number }) => e.id === etapeCuissonId);
  assert.ok(etapeCuisson.reglesDetectees.length > 0, "la cuisson doit être détectée par mots-clés");
  assert.equal(etapeCuisson.pointCritiqueHACCP, false);

  const etapeLegumes = production.etapesCritiques.find((e: { id: number }) => e.id === etapeLegumesId);
  assert.equal(etapeLegumes.pointCritiqueHACCP, true);
  assert.equal(etapeLegumes.controleHACCP, "Vérifier la propreté du matériel");
});

test("POST /productions : 404 pour une recette inexistante", async () => {
  const reponse = await fetch(`${baseUrl}/api/productions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recetteId: 999999999, cible: { mode: "portions", valeur: 1 } }),
  });
  assert.equal(reponse.status, 404);
});

test("POST /productions : refuse un corps invalide (recetteId manquant, cible négative)", async () => {
  const reponseSansRecette = await fetch(`${baseUrl}/api/productions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ cible: { mode: "portions", valeur: 1 } }),
  });
  assert.equal(reponseSansRecette.status, 400);

  const reponseCibleNegative = await fetch(`${baseUrl}/api/productions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recetteId, cible: { mode: "portions", valeur: -5 } }),
  });
  assert.equal(reponseCibleNegative.status, 400);
});

test("GET /productions et GET /productions/:id renvoient la production créée, avec résumé HACCP 0/2 avant tout contrôle", async () => {
  const reponseListe = await fetch(`${baseUrl}/api/productions`, { headers: authHeaders() });
  assert.equal(reponseListe.status, 200);
  const liste = await reponseListe.json();
  const ligne = liste.find((p: { id: number }) => p.id === productionIds[0]);
  assert.ok(ligne, "la production créée doit apparaître dans la liste");
  assert.equal(ligne.pointsCritiquesTotal, 2);
  assert.equal(ligne.pointsCritiquesControles, 0);

  const reponseDetail = await fetch(`${baseUrl}/api/productions/${productionIds[0]}`, { headers: authHeaders() });
  assert.equal(reponseDetail.status, 200);
  const detail = await reponseDetail.json();
  assert.equal(detail.id, productionIds[0]);
  assert.equal(detail.etapesCritiques.length, 2);
});

test("GET /productions/:id : 404 pour une production inexistante", async () => {
  const reponse = await fetch(`${baseUrl}/api/productions/999999999`, { headers: authHeaders() });
  assert.equal(reponse.status, 404);
});

test("POST /productions/:id/controles : enregistre un contrôle daté, apparaît ensuite en historique et fait progresser le résumé HACCP à 1/2", async () => {
  const reponse = await fetch(`${baseUrl}/api/productions/${productionIds[0]}/controles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recetteEtapeId: etapeCuissonId, valeur: "218°C à cœur", conforme: true, commentaire: "RAS" }),
  });
  const texte = await reponse.text();
  assert.equal(reponse.status, 201, texte);
  const resultat = JSON.parse(texte);
  assert.equal(resultat.controles.length, 1);
  assert.equal(resultat.controles[0].recetteEtapeId, etapeCuissonId);
  assert.equal(resultat.controles[0].valeur, "218°C à cœur");
  assert.equal(resultat.controles[0].conforme, true);
  assert.equal(resultat.controles[0].commentaire, "RAS");
  assert.ok(resultat.controles[0].dateHeure, "dateHeure doit être fixée par le serveur");

  const reponseListe = await fetch(`${baseUrl}/api/productions`, { headers: authHeaders() });
  const ligne = (await reponseListe.json()).find((p: { id: number }) => p.id === productionIds[0]);
  assert.equal(ligne.pointsCritiquesControles, 1);
  assert.equal(ligne.pointsCritiquesTotal, 2);
});

test("POST /productions/:id/controles : un second contrôle sur le point déjà contrôlé s'ajoute à l'historique sans faire progresser le résumé (toujours 1/2)", async () => {
  const reponse = await fetch(`${baseUrl}/api/productions/${productionIds[0]}/controles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recetteEtapeId: etapeCuissonId, valeur: "220°C à cœur", conforme: true }),
  });
  assert.equal(reponse.status, 201);
  const resultat = await reponse.json();
  assert.equal(resultat.controles.length, 2, "les deux contrôles du même point coexistent, aucun n'écrase l'autre");

  const reponseListe = await fetch(`${baseUrl}/api/productions`, { headers: authHeaders() });
  const ligne = (await reponseListe.json()).find((p: { id: number }) => p.id === productionIds[0]);
  assert.equal(ligne.pointsCritiquesControles, 1, "toujours 1 point distinct contrôlé, pas 2 contrôles comptés séparément");
});

test("POST /productions/:id/controles : le second point critique complète le résumé à 2/2", async () => {
  const reponse = await fetch(`${baseUrl}/api/productions/${productionIds[0]}/controles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recetteEtapeId: etapeLegumesId, valeur: "Légumes désinfectés selon protocole", conforme: true }),
  });
  assert.equal(reponse.status, 201);

  const reponseListe = await fetch(`${baseUrl}/api/productions`, { headers: authHeaders() });
  const ligne = (await reponseListe.json()).find((p: { id: number }) => p.id === productionIds[0]);
  assert.equal(ligne.pointsCritiquesControles, 2);
  assert.equal(ligne.pointsCritiquesTotal, 2);
});

test("POST /productions/:id/controles : refuse une étape appartenant à une autre recette", async () => {
  const reponse = await fetch(`${baseUrl}/api/productions/${productionIds[0]}/controles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recetteEtapeId: etapeAutreId, valeur: "peu importe", conforme: true }),
  });
  assert.equal(reponse.status, 400);
});

test("POST /productions/:id/controles : refuse une valeur vide et une étape inexistante", async () => {
  const reponseValeurVide = await fetch(`${baseUrl}/api/productions/${productionIds[0]}/controles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recetteEtapeId: etapeDresserId, valeur: "   ", conforme: true }),
  });
  assert.equal(reponseValeurVide.status, 400);

  const reponseEtapeInexistante = await fetch(`${baseUrl}/api/productions/${productionIds[0]}/controles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recetteEtapeId: 999999999, valeur: "x", conforme: true }),
  });
  assert.equal(reponseEtapeInexistante.status, 400);
});

test("POST /productions/:id/controles : 404 pour une production inexistante", async () => {
  const reponse = await fetch(`${baseUrl}/api/productions/999999999/controles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recetteEtapeId: etapeCuissonId, valeur: "x", conforme: true }),
  });
  assert.equal(reponse.status, 404);
});

test("401 sans authentification sur toutes les routes productions", async () => {
  const reponses = await Promise.all([
    fetch(`${baseUrl}/api/productions`),
    fetch(`${baseUrl}/api/productions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    fetch(`${baseUrl}/api/productions/${productionIds[0]}`),
    fetch(`${baseUrl}/api/productions/${productionIds[0]}/controles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  ]);
  for (const reponse of reponses) assert.equal(reponse.status, 401);
});
