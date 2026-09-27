import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliserIdentiteFournisseur } from "../../server/routes/articles.js";

// Teste normaliserIdentiteFournisseur (server/routes/articles.ts) — chantier « identité
// fournisseur + historique des imports ». Règle : trim + minuscule, rien d'autre.

test("trim + minuscule, rien d'autre", () => {
  assert.equal(normaliserIdentiteFournisseur("SUPER U"), "super u");
  assert.equal(normaliserIdentiteFournisseur("  Super U  "), "super u");
  assert.equal(normaliserIdentiteFournisseur("super u"), "super u");
});

test("ne retire jamais les accents", () => {
  assert.notEqual(normaliserIdentiteFournisseur("Métro"), normaliserIdentiteFournisseur("Metro"));
});

test("ne compacte jamais les espaces internes", () => {
  assert.notEqual(normaliserIdentiteFournisseur("Super  U"), normaliserIdentiteFournisseur("Super U"));
});

test("deux noms réellement différents restent différents", () => {
  assert.notEqual(normaliserIdentiteFournisseur("Metro"), normaliserIdentiteFournisseur("Promocash"));
});
