import test from "node:test";
import assert from "node:assert/strict";
import { evaluerEtapesHACCP, reglesHACCP } from "../../server/utils/haccp.js";

test("la bibliothèque HACCP contient les règles de base", () => {
  assert.ok(reglesHACCP.some((r) => r.code === "CUISSON"));
  assert.ok(reglesHACCP.some((r) => r.code === "REFROIDISSEMENT"));
});

test("une étape de refroidissement est détectée et marquée à valider sans contrôle", () => {
  const result = evaluerEtapesHACCP([{ description: "Refroidissement en cellule", pointCritiqueHACCP: false, controleHACCP: null }]);
  assert.equal(result[0].reglesDetectees[0]?.code, "REFROIDISSEMENT");
  assert.equal(result[0].aValider, true);
});

test("une étape déjà contrôlée n'est pas signalée à nouveau", () => {
  const result = evaluerEtapesHACCP([{ description: "Cuisson", pointCritiqueHACCP: true, controleHACCP: "Température contrôlée" }]);
  assert.equal(result[0].aValider, false);
});
