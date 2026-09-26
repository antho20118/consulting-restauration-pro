import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliserExtraction } from "../../src/features/recettes/utils/normaliserExtraction.js";
import type { EtapeExtraite, ExtractionRecette, IngredientExtrait, MaterielExtrait } from "../../src/features/recettes/types/recette.js";

// Teste src/features/recettes/utils/normaliserExtraction.ts — couche déterministe commune aux deux
// moteurs d'extraction (IA et repli local sans IA), voir le chantier « import photo : rendu
// professionnel ». Ne doit jamais réinterpréter le sens d'une donnée : uniquement des défauts
// mécaniques de forme (ponctuation résiduelle, doublons de lecture, ordre des étapes).

function ingredient(partiel: Partial<IngredientExtrait>): IngredientExtrait {
  return {
    texteOriginal: "",
    nomExtrait: "",
    quantite: null,
    unite: null,
    precision: null,
    confiance: "faible",
    ...partiel,
  };
}

function etape(partiel: Partial<EtapeExtraite>): EtapeExtraite {
  return {
    ordre: 1,
    titre: null,
    description: "",
    section: "autre",
    dureeMinutes: null,
    temperatureC: null,
    modeCuisson: null,
    pointCritiqueHACCP: false,
    controleHACCP: null,
    confiance: "faible",
    ...partiel,
  };
}

function materiel(partiel: Partial<MaterielExtrait>): MaterielExtrait {
  return { texteOriginal: "", nomExtrait: "", confiance: "faible", ...partiel };
}

function extraction(partiel: Partial<ExtractionRecette>): ExtractionRecette {
  return {
    nom: null,
    categorieDetectee: null,
    sousCategorieDetectee: null,
    portions: null,
    poidsPortionG: null,
    poidsAccompagnementG: null,
    ingredients: [],
    etapes: [],
    materiel: [],
    instructions: null,
    alertes: [],
    ...partiel,
  };
}

test("normaliserExtraction : ponctuation de mise en page résiduelle retirée du nom d'un ingrédient", () => {
  const resultat = normaliserExtraction(
    extraction({ ingredients: [ingredient({ nomExtrait: "- farine" })] })
  );
  assert.equal(resultat.ingredients[0].nomExtrait, "farine");
});

test("normaliserExtraction : ingrédient devenu vide après nettoyage est supprimé, jamais un fantôme", () => {
  const resultat = normaliserExtraction(extraction({ ingredients: [ingredient({ nomExtrait: "-- --" })] }));
  assert.deepEqual(resultat.ingredients, []);
});

test("normaliserExtraction : doublon strict d'ingrédient (même nom/quantité/unité) dédupliqué", () => {
  const resultat = normaliserExtraction(
    extraction({
      ingredients: [
        ingredient({ nomExtrait: "Farine", quantite: 500, unite: "g" }),
        ingredient({ nomExtrait: "Farine", quantite: 500, unite: "g" }),
      ],
    })
  );
  assert.equal(resultat.ingredients.length, 1);
});

test("normaliserExtraction : deux ingrédients de même nom mais de quantité différente ne sont jamais fusionnés", () => {
  const resultat = normaliserExtraction(
    extraction({
      ingredients: [
        ingredient({ nomExtrait: "Farine", quantite: 500, unite: "g" }),
        ingredient({ nomExtrait: "Farine", quantite: 200, unite: "g" }),
      ],
    })
  );
  assert.equal(resultat.ingredients.length, 2);
});

test("normaliserExtraction : doublon strict d'étape (même description) dédupliqué", () => {
  const resultat = normaliserExtraction(
    extraction({
      etapes: [etape({ ordre: 1, description: "Mélanger" }), etape({ ordre: 2, description: "Mélanger" })],
    })
  );
  assert.equal(resultat.etapes.length, 1);
});

test("normaliserExtraction : ordre des étapes reconstruit en séquence 1..N après suppression d'un doublon", () => {
  const resultat = normaliserExtraction(
    extraction({
      etapes: [
        etape({ ordre: 1, description: "Éplucher" }),
        etape({ ordre: 2, description: "Éplucher" }),
        etape({ ordre: 3, description: "Cuire" }),
      ],
    })
  );
  assert.equal(resultat.etapes.length, 2);
  assert.equal(resultat.etapes[0].ordre, 1);
  assert.equal(resultat.etapes[0].description, "Éplucher");
  assert.equal(resultat.etapes[1].ordre, 2);
  assert.equal(resultat.etapes[1].description, "Cuire");
});

test("normaliserExtraction : matériel dupliqué dédupliqué, ponctuation résiduelle retirée", () => {
  const resultat = normaliserExtraction(
    extraction({
      materiel: [materiel({ nomExtrait: "- Thermomètre sonde" }), materiel({ nomExtrait: "Thermomètre sonde" })],
    })
  );
  assert.equal(resultat.materiel.length, 1);
  assert.equal(resultat.materiel[0].nomExtrait, "Thermomètre sonde");
});

test("normaliserExtraction : aucune donnée certaine n'est altérée (quantité, unité, HACCP, confiance conservées)", () => {
  const resultat = normaliserExtraction(
    extraction({
      ingredients: [ingredient({ nomExtrait: "Farine", quantite: 500, unite: "g", confiance: "elevee" })],
      etapes: [
        etape({
          ordre: 1,
          description: "Cuire à cœur jusqu'à 68°C",
          pointCritiqueHACCP: true,
          controleHACCP: "Sonde de température, ≥68°C à cœur",
        }),
      ],
    })
  );
  assert.equal(resultat.ingredients[0].quantite, 500);
  assert.equal(resultat.ingredients[0].unite, "g");
  assert.equal(resultat.ingredients[0].confiance, "elevee");
  assert.equal(resultat.etapes[0].pointCritiqueHACCP, true);
  assert.equal(resultat.etapes[0].controleHACCP, "Sonde de température, ≥68°C à cœur");
});

test("normaliserExtraction : extraction vide reste vide, aucune erreur", () => {
  const resultat = normaliserExtraction(extraction({}));
  assert.deepEqual(resultat.ingredients, []);
  assert.deepEqual(resultat.etapes, []);
  assert.deepEqual(resultat.materiel, []);
});
