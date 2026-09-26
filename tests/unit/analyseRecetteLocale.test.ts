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

// Classification dressage/cuisson affinée : un vrai verbe de cuisson (cuire, griller...) l'emporte
// toujours, mais une simple mention secondaire de "cuisson"/"cuit" (ex. "jus de cuisson") ne doit
// jamais faire basculer en cuisson une étape dont l'action principale est un dressage — voir
// classifierSection dans analyseRecetteLocale.ts (correctif du contrôle post-merge PR #74).
function section(texte: string): string {
  return analyseRecetteLocale(`Nom\n1. ${texte}`).etapes[0].section;
}

test("analyseRecetteLocale : dressage malgré une référence secondaire à la cuisson (« jus de cuisson »)", () => {
  assert.equal(section("Dresser sur un plat et napper de jus de cuisson"), "dressage");
});

test("analyseRecetteLocale : dressage malgré une simple mention isolée de « cuisson » (sans verbe fort)", () => {
  assert.equal(section("Dresser l'assiette ; la cuisson est terminée"), "dressage");
});

test("analyseRecetteLocale : dressage avec décoration", () => {
  assert.equal(section("Dresser l'assiette et décorer avec quelques herbes"), "dressage");
});

test("analyseRecetteLocale : dressage avec disposer/servir", () => {
  assert.equal(section("Disposer dans l'assiette puis servir"), "dressage");
});

test("analyseRecetteLocale : vraie cuisson (verbe + mode explicites)", () => {
  assert.equal(section("Cuire au four à 180°C pendant 25 minutes"), "cuisson");
});

test("analyseRecetteLocale : vraie cuisson malgré une formulation composée", () => {
  assert.equal(section("Faire revenir puis cuire à couvert pendant 30 minutes"), "cuisson");
});

test("analyseRecetteLocale : préparation (mélanger/assaisonner)", () => {
  assert.equal(section("Mélanger les ingrédients puis assaisonner"), "preparation");
});

test("analyseRecetteLocale : une vraie étape de cuisson reste cuisson malgré un mot de dressage secondaire", () => {
  assert.equal(section("Cuire au four puis dresser rapidement en assiette"), "cuisson");
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

// Chantier « import photo → technique » (PHASE 17) : une fiche technique photographiée n'a pas
// toujours ses étapes numérotées (fiche manuscrite, mise en page libre) — le repli sans IA doit
// rester exploitable dans ce cas plutôt que de perdre silencieusement ces lignes.
test("analyseRecetteLocale : étapes reconnues même sans numérotation (une ligne libre par étape)", () => {
  const texte = [
    "Sauté de veau",
    "Éplucher et laver les légumes",
    "Émincer les oignons",
    "Faire revenir les légumes dans l'huile",
    "Ajouter le fond et cuire 45 minutes",
  ].join("\n");

  const extraction = analyseRecetteLocale(texte);

  assert.equal(extraction.nom, "Sauté de veau");
  assert.equal(extraction.etapes.length, 4);
  assert.equal(extraction.etapes[0].ordre, 1);
  assert.equal(extraction.etapes[0].description, "Éplucher et laver les légumes");
  assert.equal(extraction.etapes[1].ordre, 2);
  assert.equal(extraction.etapes[1].description, "Émincer les oignons");
  assert.equal(extraction.etapes[3].ordre, 4);
  assert.equal(extraction.etapes[3].description, "Ajouter le fond et cuire 45 minutes");
});

test("analyseRecetteLocale : mélange d'étapes numérotées et non numérotées, la numérotation reste normalisée en continu", () => {
  const texte = ["Nom", "1. Première étape numérotée", "Deuxième étape libre, sans numéro"].join("\n");
  const extraction = analyseRecetteLocale(texte);
  assert.equal(extraction.etapes.length, 2);
  assert.equal(extraction.etapes[0].ordre, 1);
  assert.equal(extraction.etapes[1].ordre, 2);
});

// Une fiche technique française contient presque toujours des caractères accentués (ingrédients,
// techniques, HACCP) : jamais tronqués ni corrompus par l'analyse par règles.
// Chantier « import photo : rendu professionnel » — corrige le défaut démontré : une ligne à
// ingrédients multiples séparés par une virgule ne devient plus un seul ingrédient au nom-phrase
// contenant une seconde quantité résiduelle, mais un ingrédient par segment quantifié.
test("analyseRecetteLocale : ligne à ingrédients multiples (virgule) séparée en autant d'ingrédients", () => {
  const extraction = analyseRecetteLocale("Nom\n2 œufs, 100 g de sucre");
  assert.equal(extraction.ingredients.length, 2);
  assert.equal(extraction.ingredients[0].quantite, 2);
  assert.equal(extraction.ingredients[0].nomExtrait, "œufs");
  assert.equal(extraction.ingredients[1].quantite, 100);
  assert.equal(extraction.ingredients[1].unite, "g");
  assert.equal(extraction.ingredients[1].nomExtrait, "sucre");
});

test("analyseRecetteLocale : une virgule à l'intérieur d'un seul ingrédient n'est jamais découpée à tort", () => {
  // Un seul segment est quantifié ("500 g de farine") : la ligne reste un ingrédient unique, pas
  // deux — jamais de découpage deviné sur un segment non quantifié ("tamisée").
  const extraction = analyseRecetteLocale("Nom\n500 g de farine, tamisée");
  assert.equal(extraction.ingredients.length, 1);
  assert.equal(extraction.ingredients[0].nomExtrait, "farine, tamisée");
});

test("analyseRecetteLocale : en-tête décoratif (tirets) ignoré, ne devient ni ingrédient ni étape parasite", () => {
  const extraction = analyseRecetteLocale(
    ["Nom", "— Ingrédients —", "500 g de farine", "--- Préparation ---", "1. Mélanger"].join("\n")
  );
  assert.equal(extraction.ingredients.length, 1);
  assert.equal(extraction.etapes.length, 1);
  assert.equal(extraction.etapes[0].description, "Mélanger");
});

test("analyseRecetteLocale : caractères accentués préservés fidèlement (nom, ingrédient, étape)", () => {
  const texte = [
    "Crème brûlée à l'ancienne",
    "250 ml de crème fraîche épaisse",
    "1. Préchauffer le four à 160°C puis chemiser les ramequins",
    "2. Verser la préparation et cuire à cœur jusqu'à 68°C. [HACCP: sonde de température, ≥68°C à cœur]",
  ].join("\n");

  const extraction = analyseRecetteLocale(texte);

  assert.equal(extraction.nom, "Crème brûlée à l'ancienne");
  assert.equal(extraction.ingredients[0].nomExtrait, "crème fraîche épaisse");
  assert.equal(extraction.etapes[0].description, "Préchauffer le four à 160°C puis chemiser les ramequins");
  assert.equal(extraction.etapes[1].pointCritiqueHACCP, true);
  assert.equal(extraction.etapes[1].controleHACCP, "sonde de température, ≥68°C à cœur");
});
