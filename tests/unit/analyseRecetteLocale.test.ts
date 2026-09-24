import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseRecetteLocale } from "../../src/features/recettes/utils/analyseRecetteLocale.js";

// Teste src/features/recettes/utils/analyseRecetteLocale.ts, le repli sans IA de l'import
// photo/texte (voir la refonte de l'import) : produit le même format ExtractionRecette enrichi que
// le moteur IA, mais ne doit jamais inventer ce qu'il ne sait pas détecter de façon fiable
// (catégorie, sous-catégorie, matériel, notes résiduelles restent toujours null/vides).

test("analyseRecetteLocale : extraction complète (nom, portions, ingrédients, étapes numérotées)", () => {
  const texte = [
    "Sauté de veau",
    "(4 personnes)",
    "500 g d'épaule de veau",
    "1 oignon",
    "1. Couper la viande en morceaux",
    "2. Faire revenir dans l'huile",
  ].join("\n");

  const extraction = analyseRecetteLocale(texte);

  assert.equal(extraction.nom, "Sauté de veau");
  assert.equal(extraction.portions, 4);
  assert.equal(extraction.ingredients.length, 2);
  assert.equal(extraction.ingredients[0].nomExtrait, "épaule de veau");
  assert.equal(extraction.ingredients[0].quantite, 500);
  assert.equal(extraction.ingredients[0].unite, "g");
  assert.equal(extraction.etapes.length, 2);
});

test("analyseRecetteLocale : catégorie/sous-catégorie/matériel/notes jamais devinés (toujours null/vides)", () => {
  const extraction = analyseRecetteLocale("Plat au four\n1. Cuire au four à 200°C pendant 30 minutes");
  assert.equal(extraction.categorieDetectee, null);
  assert.equal(extraction.sousCategorieDetectee, null);
  assert.deepEqual(extraction.materiel, []);
  assert.equal(extraction.instructions, null);
  assert.equal(extraction.poidsPortionG, null);
  assert.equal(extraction.poidsAccompagnementG, null);
});

test("analyseRecetteLocale : chaque ingrédient a une confiance faible et aucune précision inventée", () => {
  const extraction = analyseRecetteLocale("Nom\n500 g de farine");
  assert.equal(extraction.ingredients[0].confiance, "faible");
  assert.equal(extraction.ingredients[0].precision, null);
});

test("analyseRecetteLocale : classification préparation d'une étape", () => {
  const extraction = analyseRecetteLocale("Nom\n1. Éplucher et tailler les légumes en brunoise");
  assert.equal(extraction.etapes[0].section, "preparation");
});

test("analyseRecetteLocale : classification cuisson d'une étape", () => {
  const extraction = analyseRecetteLocale("Nom\n1. Cuire au four à 190°C pendant 40 minutes");
  assert.equal(extraction.etapes[0].section, "cuisson");
});

test("analyseRecetteLocale : classification dressage d'une étape", () => {
  const extraction = analyseRecetteLocale("Nom\n1. Dresser dans l'assiette et napper de sauce");
  assert.equal(extraction.etapes[0].section, "dressage");
});

test("analyseRecetteLocale : étape sans mot-clé reconnu → section autre (jamais devinée)", () => {
  const extraction = analyseRecetteLocale("Nom\n1. Réserver au frais");
  assert.equal(extraction.etapes[0].section, "autre");
});

test("analyseRecetteLocale : température unique détectée, texte intégral conservé dans description", () => {
  const extraction = analyseRecetteLocale("Nom\n1. Cuire au four à 190°C pendant 40 minutes");
  assert.equal(extraction.etapes[0].temperatureC, 190);
  assert.equal(extraction.etapes[0].dureeMinutes, 40);
  assert.equal(extraction.etapes[0].description, "Cuire au four à 190°C pendant 40 minutes");
});

test("analyseRecetteLocale : plage de température/durée jamais réduite à une valeur unique inventée", () => {
  const extraction = analyseRecetteLocale("Nom\n1. Cuire au four à 190-200°C pendant 40 à 50 minutes");
  assert.equal(extraction.etapes[0].temperatureC, null);
  assert.equal(extraction.etapes[0].dureeMinutes, null);
  // Le texte complet reste malgré tout intégralement disponible pour l'utilisateur.
  assert.match(extraction.etapes[0].description, /190-200°C/);
  assert.match(extraction.etapes[0].description, /40 à 50 minutes/);
});

test("analyseRecetteLocale : marqueur HACCP explicite reconnu et retiré de la description", () => {
  const extraction = analyseRecetteLocale(
    "Nom\n1. Cuire à cœur jusqu'à 68°C. [HACCP: sonde de température, ≥68°C à cœur]"
  );
  assert.equal(extraction.etapes[0].pointCritiqueHACCP, true);
  assert.equal(extraction.etapes[0].controleHACCP, "sonde de température, ≥68°C à cœur");
  assert.doesNotMatch(extraction.etapes[0].description, /HACCP/);
});

test("analyseRecetteLocale : source incomplète (ni ingrédient ni étape reconnue) → tableaux vides, pas d'erreur", () => {
  const extraction = analyseRecetteLocale("");
  assert.deepEqual(extraction.ingredients, []);
  assert.deepEqual(extraction.etapes, []);
  assert.equal(extraction.nom, null);
});

test("analyseRecetteLocale : alerte informant que ce repli est moins fiable que l'IA", () => {
  const extraction = analyseRecetteLocale("Nom\n1. Étape");
  assert.ok(extraction.alertes.length > 0);
});
