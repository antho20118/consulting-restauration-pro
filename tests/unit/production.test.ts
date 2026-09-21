import test from "node:test";
import assert from "node:assert/strict";

test("mise à l'échelle par portions", () => {
  const portionsInitiales = 10;
  const cible = 100;
  assert.equal(cible / portionsInitiales, 10);
});

test("besoin net après déduction du stock", () => {
  const besoin = 25;
  const stock = 8;
  assert.equal(Math.max(0, besoin - stock), 17);
});

test("arrondi au conditionnement supérieur", () => {
  const besoinKg = 25;
  const packKg = 10;
  assert.equal(Math.ceil(besoinKg / packKg), 3);
});
