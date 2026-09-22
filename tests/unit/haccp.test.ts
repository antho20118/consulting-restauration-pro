import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { evaluerEtapesHACCP, reglesHACCP } from "../../server/utils/haccp.js";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Teste server/utils/haccp.ts après l'audit produit qui a identifié deux défauts :
//
// 1. Le signal humain explicite (etape.pointCritiqueHACCP, coché par l'utilisateur en éditant la
//    recette) était reçu par evaluerEtapesHACCP() mais jamais lu : seule la détection par
//    mots-clés sur la description comptait. Un utilisateur pouvait cocher « point critique » sur
//    une étape non détectée par les mots-clés, et l'évaluation automatique disait quand même
//    aValider=false, contredisant silencieusement sa propre déclaration.
// 2. controleHACCP non vide (y compris un seul espace) suffisait à faire disparaître l'alerte,
//    sans garantie qu'un contrôle réel ait été documenté.
//
// L'audit a aussi trouvé que ni GET /api/haccp/evaluer/:id ni son résultat n'étaient jamais
// consommés par le frontend (recherche exhaustive dans src/, aucun résultat) : le moteur
// existait, était testé en pur, mais restait invisible pour un utilisateur réel. Corrigé en
// branchant l'évaluation dans RecetteDetail.tsx.
//
// Trois niveaux de test :
// - [1] à [12] : tests unitaires purs de evaluerEtapesHACCP() (aucune base de données).
// - [13] à [16] : vérifications explicites d'absence de collision de mots-clés (un mot-clé
//   apparaissant par accident dans un mot français sans rapport).
// - [17] à [21] : scénarios réels HTTP + PostgreSQL contre GET /api/haccp/regles et
//   GET /api/haccp/evaluer/:id (route jusqu'ici jamais testée au niveau HTTP).

test("[1] la bibliothèque HACCP contient les règles de base", () => {
  assert.ok(reglesHACCP.some((r) => r.code === "CUISSON"));
  assert.ok(reglesHACCP.some((r) => r.code === "REFROIDISSEMENT"));
});

test("[2] une étape de refroidissement est détectée par mot-clé et marquée à valider sans contrôle", () => {
  const result = evaluerEtapesHACCP([{ description: "Refroidissement en cellule", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees[0]?.code, "REFROIDISSEMENT");
  assert.equal(result[0].aValider, true);
});

test("[3] une étape déjà contrôlée (texte documenté) n'est pas signalée à nouveau", () => {
  const result = evaluerEtapesHACCP([{ description: "Cuisson", pointCritiqueHACCP: true, controleHACCP: "Température contrôlée" }]);
  assert.equal(result[0].aValider, false);
});

test("[4] un controleHACCP réduit à des espaces ne compte pas comme documenté", () => {
  const result = evaluerEtapesHACCP([{ description: "Cuisson à cœur", pointCritiqueHACCP: true, controleHACCP: "   " }]);
  assert.equal(result[0].aValider, true, "un simple espace ne doit plus suffire à faire disparaître l'alerte");
});

test("[5] CORRECTIF PRINCIPAL : le signal humain pointCritiqueHACCP suffit seul, même sans détection par mots-clés", () => {
  // Description neutre, aucun mot-clé d'aucune règle : avant le correctif, aValider valait
  // false malgré la case cochée par l'utilisateur.
  const result = evaluerEtapesHACCP([{ description: "Étape spécifique à l'établissement", pointCritiqueHACCP: true, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees.length, 0, "aucune règle ne doit être détectée par mot-clé ici");
  assert.equal(result[0].aValider, true, "le signal humain pointCritiqueHACCP doit suffire à lui seul");
});

test("[6] pointCritiqueHACCP=true avec un contrôle documenté et aucune règle détectée : aValider=false", () => {
  const result = evaluerEtapesHACCP([{ description: "Étape spécifique à l'établissement", pointCritiqueHACCP: true, controleHACCP: "Vérifié selon la procédure interne" }]);
  assert.equal(result[0].aValider, false);
});

test("[7] étape ni signalée ni détectée : aucune alerte", () => {
  const result = evaluerEtapesHACCP([{ description: "Dresser l'assiette", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees.length, 0);
  assert.equal(result[0].aValider, false);
});

test("[8] les champs d'origine de l'étape (id, ordre...) sont conservés intégralement dans le résultat", () => {
  // evaluerEtapesHACCP est générique (comme calculerCoutRecette) : le type du paramètre ne doit
  // pas limiter les champs conservés sur l'objet retourné.
  const result = evaluerEtapesHACCP([{ id: 42, ordre: 3, description: "Dresser", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal((result[0] as { id: number }).id, 42);
  assert.equal((result[0] as { ordre: number }).ordre, 3);
});

test("[9] preuve de régression comblée : « Passer au four à 220°C pendant 25 minutes » est désormais détectée comme cuisson", () => {
  // Avant l'ajout de « au four » aux mots-clés CUISSON, cette phrase parfaitement normale ne
  // contenait aucun des mots-clés existants (cuire, cuisson, rôtir, bouillir, poêler) et ne
  // déclenchait donc rien.
  const result = evaluerEtapesHACCP([{ description: "Passer au four à 220°C pendant 25 minutes", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees.some((r) => r.code === "CUISSON"), true);
});

test("[9bis] « Le produit a été refroidi rapidement en cellule » est détectée (forme au participe passé)", () => {
  // « refroidi » (participe passé) n'était pas une sous-chaîne de « refroidir » (infinitif) ni de
  // « refroidissement », donc jamais détecté dans cette forme.
  const result = evaluerEtapesHACCP([{ description: "Le produit a été refroidi rapidement en cellule", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees.some((r) => r.code === "REFROIDISSEMENT"), true);
});

test("[9ter] « Remettre en température au bain-marie » est détectée", () => {
  const result = evaluerEtapesHACCP([{ description: "Remettre en température au bain-marie", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees.some((r) => r.code === "REMISE_TEMPERATURE"), true);
});

test("[9quater] « Mettre au congélateur » est détectée", () => {
  const result = evaluerEtapesHACCP([{ description: "Mettre au congélateur", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees.some((r) => r.code === "FROID"), true);
});

test("[9quinquies] « Éplucher et désinfecter les carottes » est détectée sans le mot « légume »", () => {
  const result = evaluerEtapesHACCP([{ description: "Éplucher et désinfecter les carottes", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees.some((r) => r.code === "LEGUMES_CRUS"), true);
});

test("[13] absence de collision : « fourchette » et « fournisseur » ne déclenchent jamais CUISSON via « au four »", () => {
  const result = evaluerEtapesHACCP([
    { description: "Disposer la fourchette à droite de l'assiette", pointCritiqueHACCP: false, controleHACCP: null },
    { description: "Contacter le fournisseur pour la livraison", pointCritiqueHACCP: false, controleHACCP: null },
  ]);
  assert.equal(result[0].reglesDetectees.some((r) => r.code === "CUISSON"), false);
  assert.equal(result[1].reglesDetectees.some((r) => r.code === "CUISSON"), false);
});

test("[14] absence de collision : « grille » (le support) ne déclenche pas CUISSON via « griller », et « du four » n'est pas « au four »", () => {
  const result = evaluerEtapesHACCP([{ description: "Poser sur la grille du four", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees.length, 0, "ni « grille » (6 lettres, plus court que « griller ») ni « du four » (pas « au four ») ne doivent matcher");
});

test("[15] absence de collision : « biscuit » ne déclenche jamais CUISSON (aucun mot-clé « cuit » nu)", () => {
  const result = evaluerEtapesHACCP([{ description: "Décorer avec un biscuit maison", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees.length, 0);
});

test("[16] absence de collision : « confit » ne déclenche jamais CUISSON via « frit »", () => {
  const result = evaluerEtapesHACCP([{ description: "Ajouter le confit d'oignon", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees.length, 0);
});

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieRecetteId: number;
const recetteIds: number[] = [];

async function creerRecette(body: unknown): Promise<{ id: number; etapes: { id: number }[] }> {
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
  const categorieRecette =
    (await prisma.categorieRecette.findFirst()) ?? (await prisma.categorieRecette.create({ data: { nom: "Catégorie recette de test" } }));
  categorieRecetteId = categorieRecette.id;
});

after(async () => {
  await prisma.recetteLigne.deleteMany({ where: { recetteId: { in: recetteIds } } });
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("[17] GET /api/haccp/regles renvoie la bibliothèque de règles réelle", async () => {
  const reponse = await fetch(`${baseUrl}/api/haccp/regles`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(reponse.status, 200);
  const regles = await reponse.json();
  assert.ok(Array.isArray(regles));
  assert.ok(regles.some((r: { code: string }) => r.code === "CUISSON"));
});

test("[18] GET /api/haccp/evaluer/:id réel : le signal humain seul (sans mot-clé détecté) déclenche aValider=true", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "HACCP TEST étape signal humain seul",
    categorieId: categorieRecetteId,
    sousCategorieId: null,
    portions: 1,
    lignes: [],
    etapes: [{ description: "Étape spécifique à l'établissement", pointCritiqueHACCP: true, controleHACCP: null }],
  });

  const reponse = await fetch(`${baseUrl}/api/haccp/evaluer/${recette.id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.etapes.length, 1);
  assert.equal(resultat.etapes[0].id, recette.etapes[0].id, "l'id de l'étape doit être conservé pour que le frontend puisse la relier");
  assert.equal(resultat.etapes[0].reglesDetectees.length, 0);
  assert.equal(resultat.etapes[0].aValider, true, "le signal humain doit suffire seul, sans détection par mot-clé");
});

test("[19] GET /api/haccp/evaluer/:id réel : une étape détectée par mot-clé mais non signalée manuellement déclenche aussi aValider=true", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "HACCP TEST étape mot-clé non signalée",
    categorieId: categorieRecetteId,
    sousCategorieId: null,
    portions: 1,
    lignes: [],
    etapes: [{ description: "Passer au four à 220°C pendant 25 minutes", pointCritiqueHACCP: false, controleHACCP: null }],
  });

  const reponse = await fetch(`${baseUrl}/api/haccp/evaluer/${recette.id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.etapes[0].pointCritiqueHACCP, false, "le champ humain n'est jamais modifié par l'évaluation automatique");
  assert.ok(resultat.etapes[0].reglesDetectees.some((r: { code: string }) => r.code === "CUISSON"));
  assert.equal(resultat.etapes[0].aValider, true);
});

test("[20] GET /api/haccp/evaluer/:id renvoie 404 pour une recette inexistante", async () => {
  const reponse = await fetch(`${baseUrl}/api/haccp/evaluer/999999999`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(reponse.status, 404);
});

test("[21] GET /api/haccp/evaluer/:id refuse un identifiant invalide (400)", async () => {
  const reponse = await fetch(`${baseUrl}/api/haccp/evaluer/pas-un-nombre`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(reponse.status, 400);
});
