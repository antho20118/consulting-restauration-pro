import test from "node:test";
import assert from "node:assert/strict";
import { calculerCoutRecette, prixParUniteBase } from "../../server/utils/coutRecette.js";

function recette(overrides: Partial<Parameters<typeof calculerCoutRecette>[0]> = {}) {
  return {
    portions: 10,
    prixVenteHT: 12,
    lignes: [
      {
        quantite: 1,
        unite: { facteurBase: 1000 },
        gainCuissonPct: 0,
        article: {
          rendement: 100,
          tarifs: [
            {
              prixHT: 4,
              quantiteConditionnement: 1,
              unite: { facteurBase: 1000 },
            },
          ],
          allergenes: [],
          nutrition: null,
        },
      },
    ],
    ...overrides,
  };
}

test("calcule le coût total et le coût par portion", () => {
  const result = calculerCoutRecette(recette());

  assert.equal(result.coutTotal, 4);
  assert.equal(result.coutParPortion, 0.4);
  assert.equal(result.foodCostPct, (0.4 / 12) * 100);
  assert.equal(result.margeHT, 11.6);
});

test("normalise correctement le prix d'un conditionnement fournisseur", () => {
  const tarif = {
    prixHT: 65,
    quantiteConditionnement: 10,
    unite: { facteurBase: 1000 },
  };

  assert.equal(prixParUniteBase(tarif), 0.0065);

  const result = calculerCoutRecette(
    recette({
      portions: 10,
      lignes: [
        {
          quantite: 1,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 0,
          article: {
            rendement: 100,
            tarifs: [tarif],
            allergenes: [],
            nutrition: null,
          },
        },
      ],
    })
  );

  assert.equal(result.coutTotal, 6.5);
  assert.equal(result.coutParPortion, 0.65);
});

test("conserve la compatibilité avec un ancien tarif déjà exprimé à l'unité", () => {
  const result = calculerCoutRecette(recette());

  assert.equal(result.coutTotal, 4);
  assert.equal(result.coutParPortion, 0.4);
});

test("intègre correctement le rendement matière dans le coût", () => {
  const result = calculerCoutRecette(
    recette({
      lignes: [
        {
          quantite: 1,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 0,
          article: {
            rendement: 80,
            tarifs: [
              {
                prixHT: 4,
                quantiteConditionnement: 1,
                unite: { facteurBase: 1000 },
              },
            ],
            allergenes: [],
            nutrition: null,
          },
        },
      ],
    })
  );

  assert.equal(result.coutTotal, 5);
  assert.equal(result.coutParPortion, 0.5);
  assert.equal(result.poidsFiniTotalG, 800);
});

test("combine conditionnement et rendement avant de calculer le coût par portion", () => {
  const result = calculerCoutRecette(
    recette({
      portions: 20,
      lignes: [
        {
          quantite: 2,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 0,
          article: {
            rendement: 80,
            tarifs: [
              {
                prixHT: 65,
                quantiteConditionnement: 10,
                unite: { facteurBase: 1000 },
              },
            ],
            allergenes: [],
            nutrition: null,
          },
        },
      ],
    })
  );

  // 2 kg × 6,50 €/kg / 80 % = 16,25 € ; / 20 portions = 0,8125 €.
  assert.equal(result.coutTotal, 16.25);
  assert.equal(result.coutParPortion, 0.8125);
  assert.equal(result.poidsFiniTotalG, 1600);
});

test("calcule le poids fini avec le gain de cuisson", () => {
  const result = calculerCoutRecette(
    recette({
      lignes: [
        {
          quantite: 1,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 20,
          article: {
            rendement: 80,
            tarifs: [
              {
                prixHT: 4,
                quantiteConditionnement: 1,
                unite: { facteurBase: 1000 },
              },
            ],
            allergenes: [],
            nutrition: null,
          },
        },
      ],
    })
  );

  assert.equal(result.poidsFiniTotalG, 1000);
});

test("déduit les allergènes de l'ensemble des ingrédients sans doublons", () => {
  const result = calculerCoutRecette(
    recette({
      lignes: [
        {
          quantite: 1,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 0,
          article: {
            rendement: 100,
            tarifs: [
              {
                prixHT: 4,
                quantiteConditionnement: 1,
                unite: { facteurBase: 1000 },
              },
            ],
            allergenes: [
              { allergene: { id: 2, nom: "Lait" } },
              { allergene: { id: 1, nom: "Gluten" } },
            ],
            nutrition: null,
          },
        },
        {
          quantite: 500,
          unite: { facteurBase: 1 },
          gainCuissonPct: 0,
          article: {
            rendement: 100,
            tarifs: [
              {
                prixHT: 1,
                quantiteConditionnement: 1,
                unite: { facteurBase: 1 },
              },
            ],
            allergenes: [{ allergene: { id: 2, nom: "Lait" } }],
            nutrition: null,
          },
        },
      ],
    })
  );

  assert.deepEqual(result.allergenes, [
    { id: 1, nom: "Gluten" },
    { id: 2, nom: "Lait" },
  ]);
});

test("refuse un conditionnement nul ou négatif", () => {
  assert.throws(
    () =>
      prixParUniteBase({
        prixHT: 65,
        quantiteConditionnement: 0,
        unite: { facteurBase: 1000 },
      }),
    /Quantité de conditionnement invalide/
  );
});

test("refuse un rendement nul ou négatif", () => {
  assert.throws(
    () =>
      calculerCoutRecette(
        recette({
          lignes: [
            {
              quantite: 1,
              unite: { facteurBase: 1000 },
              gainCuissonPct: 0,
              article: {
                rendement: 0,
                tarifs: [
                  {
                    prixHT: 4,
                    quantiteConditionnement: 1,
                    unite: { facteurBase: 1000 },
                  },
                ],
                allergenes: [],
                nutrition: null,
              },
            },
          ],
        })
      ),
    /Rendement article invalide/
  );
});

test("refuse une recette à 0 portion (et n'utilise jamais le coût total comme coût par portion)", () => {
  assert.throws(() => calculerCoutRecette(recette({ portions: 0 })), /Nombre de portions invalide/);
});

test("refuse une recette à un nombre de portions négatif", () => {
  assert.throws(() => calculerCoutRecette(recette({ portions: -1 })), /Nombre de portions invalide/);
});

test("agrège les valeurs nutritionnelles par portion sans jamais les diviser par le rendement", () => {
  const result = calculerCoutRecette(
    recette({
      portions: 10,
      lignes: [
        {
          quantite: 1,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 0,
          article: {
            // Rendement volontairement très inférieur à 100 : si le calcul divisait la nutrition
            // par le rendement (comme le coût), le résultat serait 400 kcal/portion au lieu de 200.
            rendement: 50,
            tarifs: [],
            allergenes: [],
            nutrition: {
              energie: 200,
              proteines: 10,
              glucides: 20,
              sucres: 5,
              lipides: 8,
              acidesGrasSatures: 2,
              fibres: 3,
              sel: 1,
            },
          },
        },
      ],
    })
  );

  // 1 kg (1000g base) × 200 kcal / 100g = 2000 kcal au total ; / 10 portions = 200 kcal/portion.
  assert.equal(result.valeursNutritionnelles.energie, 200);
  assert.equal(result.valeursNutritionnelles.proteines, 10);
  assert.equal(result.valeursNutritionnelles.sel, 1);
  assert.equal(result.nutritionIncomplete, false);
});

test("signale une nutrition incomplète quand un ingrédient n'a aucune valeur saisie", () => {
  const result = calculerCoutRecette(recette());

  assert.equal(result.nutritionIncomplete, true);
  assert.equal(result.valeursNutritionnelles.energie, 0);
});

test("signale une nutrition incomplète quand un seul champ manque sur un ingrédient", () => {
  const result = calculerCoutRecette(
    recette({
      portions: 10,
      lignes: [
        {
          quantite: 1,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 0,
          article: {
            rendement: 100,
            tarifs: [],
            allergenes: [],
            nutrition: {
              energie: 200,
              proteines: 10,
              glucides: 20,
              sucres: 5,
              lipides: 8,
              acidesGrasSatures: 2,
              fibres: 3,
              sel: null,
            },
          },
        },
      ],
    })
  );

  assert.equal(result.nutritionIncomplete, true);
  assert.equal(result.valeursNutritionnelles.energie, 200);
  assert.equal(result.valeursNutritionnelles.sel, 0);
});

test("additionne les valeurs nutritionnelles de plusieurs ingrédients", () => {
  const result = calculerCoutRecette(
    recette({
      portions: 2,
      lignes: [
        {
          quantite: 1,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 0,
          article: {
            rendement: 100,
            tarifs: [],
            allergenes: [],
            nutrition: {
              energie: 100,
              proteines: 0,
              glucides: 0,
              sucres: 0,
              lipides: 0,
              acidesGrasSatures: 0,
              fibres: 0,
              sel: 0,
            },
          },
        },
        {
          quantite: 500,
          unite: { facteurBase: 1 },
          gainCuissonPct: 0,
          article: {
            rendement: 100,
            tarifs: [],
            allergenes: [],
            nutrition: {
              energie: 50,
              proteines: 0,
              glucides: 0,
              sucres: 0,
              lipides: 0,
              acidesGrasSatures: 0,
              fibres: 0,
              sel: 0,
            },
          },
        },
      ],
    })
  );

  // (1000g × 100/100) + (500g × 50/100) = 1000 + 250 = 1250 kcal au total ; / 2 portions = 625.
  assert.equal(result.valeursNutritionnelles.energie, 625);
  assert.equal(result.nutritionIncomplete, false);
});
