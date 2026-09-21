import test from "node:test";
import assert from "node:assert/strict";

test("normalisation d'un tarif de conditionnement pour un achat", () => {
  const prixHT = 65;
  const quantiteConditionnement = 10;
  const facteurBase = 1;
  assert.equal(prixHT / (quantiteConditionnement * facteurBase), 6.5);
});

test("un besoin de 25 kg à acheter en sacs de 10 kg donne 3 sacs", () => {
  assert.equal(Math.ceil(25 / 10), 3);
});
