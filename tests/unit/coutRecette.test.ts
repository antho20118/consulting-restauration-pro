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

// Convention métier (décision du 15/10) : la quantité saisie dans une recette est le poids BRUT,
// tel qu'acheté (ex. 1 kg de pommes de terre non épluchées). Le coût d'une ligne est donc
// quantité × prix, sans division par le rendement ; le rendement ne réduit que le poids fini (et la
// part réellement consommée, pour la nutrition). Le rendement n'est ainsi compté qu'une fois dans le
// prix de revient au kilo fini. Avant, il l'était deux fois (coût divisé ET poids fini réduit).
test("rendement : le coût d'une ligne est quantité brute × prix, le rendement ne réduit que le poids fini", () => {
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

  assert.equal(result.coutTotal, 4);
  assert.equal(result.coutParPortion, 0.4);
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

  // 2 kg bruts × 6,50 €/kg = 13 € ; / 20 portions = 0,65 €.
  assert.equal(result.coutTotal, 13);
  assert.equal(result.coutParPortion, 0.65);
  assert.equal(result.poidsFiniTotalG, 1600);
});

test("exemple métier : 1 kg de pommes de terre à 10 €/kg, rendement 80 % → 10 €, 800 g, 12,50 €/kg fini", () => {
  const result = calculerCoutRecette(
    recette({
      portions: 1,
      lignes: [
        {
          quantite: 1,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 0,
          article: {
            rendement: 80,
            tarifs: [{ prixHT: 10, quantiteConditionnement: 1, unite: { facteurBase: 1000 } }],
            allergenes: [],
            nutrition: null,
          },
        },
      ],
    })
  );

  assert.equal(result.coutTotal, 10);
  assert.equal(result.poidsFiniTotalG, 800);
  assert.equal(result.coutParKgFini, 12.5);
});

test("prix de revient au kilo fini : null quand le poids fini est nul", () => {
  const result = calculerCoutRecette(recette({ lignes: [] }));
  assert.equal(result.coutParKgFini, null);
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

test("nutrition : seule la part consommée (quantité brute × rendement) est comptée, jamais les épluchures", () => {
  const result = calculerCoutRecette(
    recette({
      portions: 10,
      lignes: [
        {
          quantite: 1,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 0,
          article: {
            // Rendement de 50 % : sur 1 kg acheté, 500 g sont réellement consommés.
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

  // 1 kg brut × 50 % = 500 g consommés × 200 kcal / 100 g = 1000 kcal ; / 10 portions = 100 kcal.
  assert.equal(result.valeursNutritionnelles.energie, 100);
  assert.equal(result.valeursNutritionnelles.proteines, 5);
  assert.equal(result.valeursNutritionnelles.sel, 0.5);
  assert.equal(result.nutritionIncomplete, false);
});

test("nutrition : un rendement supérieur à 100 % (absorption d'eau) n'ajoute aucune valeur nutritionnelle", () => {
  const nutrition = { energie: 350, proteines: 7, glucides: 78, sucres: 0, lipides: 1, acidesGrasSatures: 0, fibres: 1, sel: 0 };
  const result = calculerCoutRecette(
    recette({
      portions: 10,
      lignes: [
        {
          quantite: 1,
          unite: { facteurBase: 1000 },
          gainCuissonPct: 0,
          // Riz sec : 1 kg acheté donne 2,5 kg cuit, mais apporte toujours 3 500 kcal.
          article: { rendement: 250, tarifs: [], allergenes: [], nutrition },
        },
      ],
    })
  );
  assert.equal(result.valeursNutritionnelles.energie, 350);
  assert.equal(result.poidsFiniTotalG, 2500);
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
