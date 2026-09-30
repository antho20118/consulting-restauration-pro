import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseNutritionLocale } from "../../src/features/ingredients/utils/analyseNutritionLocale.js";

// Moteur de repli sans IA (mots-clés + regex) pour l'import allergènes/nutrition — voir
// server/utils/importNutritionIA.ts pour le moteur IA équivalent et
// tests/unit/articlesImportNutritionIA.test.ts pour le volet sécurité de la route qui déclenche ce
// repli. Même principe que analyseRecetteLocale.test.ts : ne teste que des formulations standards,
// avec une confiance "faible" assumée partout.

test("détecte plusieurs allergènes à partir d'une liste d'ingrédients", () => {
  const resultat = analyseNutritionLocale(
    "Ingrédients : farine de blé, lait entier, oeufs, traces éventuelles de fruits à coque."
  );
  const codes = resultat.allergenesDetectes.map((a) => a.code).sort();
  assert.deepEqual(codes, ["FRUITS_A_COQUE", "GLUTEN", "LAIT", "OEUFS"]);
  assert.ok(resultat.allergenesDetectes.every((a) => a.confiance === "faible"));
});

test("aucun allergène détecté sur un texte qui n'en mentionne aucun", () => {
  const resultat = analyseNutritionLocale("Ingrédients : eau, sucre, arôme naturel de vanille.");
  assert.deepEqual(resultat.allergenesDetectes, []);
});

test("extrait les 8 valeurs nutritionnelles d'une étiquette standard, y compris avec un double affichage kJ/kcal", () => {
  const resultat = analyseNutritionLocale(
    "Valeurs nutritionnelles moyennes pour 100 g : " +
      "Énergie 1046 kJ / 250 kcal, Protéines 5 g, Glucides 20 g dont sucres 10 g, " +
      "Lipides 3 g dont acides gras saturés 1 g, Fibres alimentaires 2 g, Sel 0,5 g."
  );
  assert.deepEqual(resultat.nutrition, {
    energie: 250,
    proteines: 5,
    glucides: 20,
    sucres: 10,
    lipides: 3,
    acidesGrasSatures: 1,
    fibres: 2,
    sel: 0.5,
  });
});

test("laisse à null les champs absents du texte, sans rien inventer", () => {
  const resultat = analyseNutritionLocale("Protéines 8 g. Sel 1,2 g.");
  assert.equal(resultat.nutrition.proteines, 8);
  assert.equal(resultat.nutrition.sel, 1.2);
  assert.equal(resultat.nutrition.energie, null);
  assert.equal(resultat.nutrition.glucides, null);
  assert.equal(resultat.nutrition.sucres, null);
  assert.equal(resultat.nutrition.lipides, null);
  assert.equal(resultat.nutrition.acidesGrasSatures, null);
  assert.equal(resultat.nutrition.fibres, null);
});

test("signale systématiquement la moindre fiabilité de l'analyse locale", () => {
  const resultat = analyseNutritionLocale("Sel 1 g.");
  assert.equal(resultat.alertes.length, 1);
  assert.match(resultat.alertes[0], /sans IA/i);
});
