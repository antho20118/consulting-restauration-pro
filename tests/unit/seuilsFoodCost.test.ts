import test from "node:test";
import assert from "node:assert/strict";
import { SEUIL_BON, SEUIL_ATTENTION, niveauFoodCost } from "../../server/utils/seuilsFoodCost.js";

// Source métier commune au tableau de bord et à l'agent Consulting (voir server/routes/dashboard.ts
// et server/routes/consulting.ts). Test unitaire pur, sans DB/HTTP : les 5 valeurs de frontière
// exactes demandées, sans aucun risque d'imprécision flottante liée au moteur de coût.

test("valeurs de seuil inchangées : 28 % et 35 %", () => {
  assert.equal(SEUIL_BON, 28);
  assert.equal(SEUIL_ATTENTION, 35);
});

test("niveauFoodCost : frontières exactes", () => {
  assert.equal(niveauFoodCost(27.99), "bon");
  assert.equal(niveauFoodCost(28), "bon");
  assert.equal(niveauFoodCost(28.01), "attention");
  assert.equal(niveauFoodCost(35), "attention");
  assert.equal(niveauFoodCost(35.01), "critique");
});

test("niveauFoodCost : valeurs franches dans chaque palier", () => {
  assert.equal(niveauFoodCost(0), "bon");
  assert.equal(niveauFoodCost(15), "bon");
  assert.equal(niveauFoodCost(30), "attention");
  assert.equal(niveauFoodCost(50), "critique");
  assert.equal(niveauFoodCost(100), "critique");
});
