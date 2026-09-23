import { test } from "node:test";
import assert from "node:assert/strict";
import { POINTS_CRITIQUES_HACCP } from "../../src/features/recettes/utils/pointsCritiquesHACCP.js";

// Teste src/features/recettes/utils/pointsCritiquesHACCP.ts — la liste déroulante de RecetteForm.tsx
// (PR #48) s'appuie entièrement sur ce tableau : chaque option affichée correspond à `titre`, et la
// sélection pré-remplit `controleHACCP` avec `description` via un simple `.find()` sur `titre`. Ces
// tests garantissent l'intégrité de la donnée elle-même (pas de doublon, pas d'entrée vide) — une
// régression ici casserait silencieusement le sélecteur (option dupliquée, ou pré-remplissage avec
// une chaîne vide qui échouerait ensuite au contrôle `controleDocumente` du moteur HACCP, voir
// server/utils/haccp.ts).

test("10 points critiques standards, comme annoncé dans la PR", () => {
  assert.equal(POINTS_CRITIQUES_HACCP.length, 10);
});

test("chaque point a un titre et une description non vides", () => {
  for (const point of POINTS_CRITIQUES_HACCP) {
    assert.ok(point.titre.trim().length > 0, `titre vide pour ${JSON.stringify(point)}`);
    assert.ok(point.description.trim().length > 0, `description vide pour "${point.titre}"`);
  }
});

test("aucun titre en doublon (les options du <select> doivent être uniques)", () => {
  const titres = POINTS_CRITIQUES_HACCP.map((p) => p.titre);
  assert.equal(new Set(titres).size, titres.length);
});

test("la recherche par titre (logique du onChange du sélecteur) retrouve la bonne description", () => {
  const trouve = POINTS_CRITIQUES_HACCP.find((p) => p.titre === "Refroidissement");
  assert.ok(trouve);
  assert.match(trouve.description, /refroidir/i);
});

test("un titre inconnu ne retourne rien (comportement attendu quand rien n'est sélectionné)", () => {
  const trouve = POINTS_CRITIQUES_HACCP.find((p) => p.titre === "");
  assert.equal(trouve, undefined);
});
