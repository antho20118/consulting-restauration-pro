import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliserNomArticle,
  trouverArticlesCorrespondants,
} from "../../src/features/ingredients/utils/correspondanceArticle.js";

// Teste correspondanceArticle.ts — détection de doublon pour la création manuelle d'un article
// (voir IngredientForm.tsx) : volontairement une correspondance exacte uniquement (par référence
// puis par nom normalisé), jamais une correspondance floue comme l'import listing, pour ne
// signaler qu'un doublon évident.

test("Cas 1 : liste d'articles existants vide -> aucune correspondance", () => {
  const resultat = trouverArticlesCorrespondants("Farine T55", "", []);
  assert.deepEqual(resultat, []);
});

test("Cas 2 : nom inexistant -> aucune correspondance", () => {
  const existants = [{ id: 1, nom: "Farine T55", reference: null, actif: true }];
  const resultat = trouverArticlesCorrespondants("Beurre doux", "", existants);
  assert.deepEqual(resultat, []);
});

test("correspondance exacte par nom (même casse, même orthographe)", () => {
  const existants = [{ id: 1, nom: "Farine T55", reference: null, actif: true }];
  const resultat = trouverArticlesCorrespondants("Farine T55", "", existants);
  assert.equal(resultat.length, 1);
  assert.equal(resultat[0].id, 1);
});

test("correspondance normalisée : casse différente", () => {
  const existants = [{ id: 1, nom: "Farine T55", reference: null, actif: true }];
  const resultat = trouverArticlesCorrespondants("FARINE T55", "", existants);
  assert.equal(resultat.length, 1);
});

test("correspondance normalisée : espaces différents", () => {
  const existants = [{ id: 1, nom: "Farine T55", reference: null, actif: true }];
  const resultat = trouverArticlesCorrespondants("  Farine   T55  ", "", existants);
  assert.equal(resultat.length, 1);
});

test("correspondance normalisée : accents différents", () => {
  const existants = [{ id: 1, nom: "Crème fraîche", reference: null, actif: true }];
  const resultat = trouverArticlesCorrespondants("Creme fraiche", "", existants);
  assert.equal(resultat.length, 1);
});

test("article inactif ignoré : aucune alerte, création autorisée", () => {
  const existants = [{ id: 1, nom: "Farine T55", reference: null, actif: false }];
  const resultat = trouverArticlesCorrespondants("Farine T55", "", existants);
  assert.deepEqual(resultat, []);
});

test("article inactif ignoré même si un autre actif porte un nom différent", () => {
  const existants = [
    { id: 1, nom: "Farine T55", reference: null, actif: false },
    { id: 2, nom: "Beurre doux", reference: null, actif: true },
  ];
  const resultat = trouverArticlesCorrespondants("Farine T55", "", existants);
  assert.deepEqual(resultat, []);
});

test("plusieurs correspondances actives sont toutes signalées (aucun choix silencieux)", () => {
  const existants = [
    { id: 1, nom: "Farine T55", reference: null, actif: true },
    { id: 2, nom: "farine t55", reference: null, actif: true },
  ];
  const resultat = trouverArticlesCorrespondants("Farine T55", "", existants);
  assert.equal(resultat.length, 2);
  assert.deepEqual(resultat.map((a) => a.id).sort(), [1, 2]);
});

test("aucun faux positif : un nom incluant l'autre n'est jamais considéré comme doublon (pas de correspondance floue)", () => {
  const existants = [{ id: 1, nom: "Farine", reference: null, actif: true }];
  const resultat = trouverArticlesCorrespondants("Farine de sarrasin", "", existants);
  assert.deepEqual(resultat, []);
});

test("correspondance par référence exacte, même si le nom saisi diffère", () => {
  const existants = [{ id: 1, nom: "Farine T55 Moulin Bio", reference: "REF-001", actif: true }];
  const resultat = trouverArticlesCorrespondants("Farine T55", "REF-001", existants);
  assert.equal(resultat.length, 1);
  assert.equal(resultat[0].id, 1);
});

test("référence différente entre deux articles au nom identique : pas de correspondance par référence, mais le nom matche quand même", () => {
  const existants = [{ id: 1, nom: "Farine T55", reference: "REF-999", actif: true }];
  const resultat = trouverArticlesCorrespondants("Farine T55", "REF-AUTRE", existants);
  // La référence ne matche pas ("REF-AUTRE" != "REF-999") : on retombe sur le nom, qui matche.
  assert.equal(resultat.length, 1);
});

test("référence vide ou absente : la correspondance se fait uniquement sur le nom", () => {
  const existants = [{ id: 1, nom: "Farine T55", reference: "REF-001", actif: true }];
  const resultat = trouverArticlesCorrespondants("Farine T55", "", existants);
  assert.equal(resultat.length, 1);
});

test("Cas 9 : référence vide des deux côtés -> aucune correspondance par référence, mais le nom peut toutefois correspondre", () => {
  const existants = [{ id: 1, nom: "Farine T55", reference: null, actif: true }];
  const resultat = trouverArticlesCorrespondants("Farine T55", "", existants);
  assert.equal(resultat.length, 1);
  assert.equal(resultat[0].id, 1);
});

test("Cas 12 : deux articles actifs partagent la même référence -> toutes les correspondances sont retournées, aucun choix arbitraire", () => {
  const existants = [
    { id: 1, nom: "Farine T55 Moulin Bio", reference: "REF-001", actif: true },
    { id: 2, nom: "Farine T55 Autre Marque", reference: "REF-001", actif: true },
  ];
  const resultat = trouverArticlesCorrespondants("Farine T55", "REF-001", existants);
  assert.equal(resultat.length, 2);
  assert.deepEqual(resultat.map((a) => a.id).sort(), [1, 2]);
});

test("Cas 12bis : parmi deux articles à référence identique, un inactif est exclu, seul l'actif est retourné", () => {
  const existants = [
    { id: 1, nom: "Farine T55 Moulin Bio", reference: "REF-001", actif: true },
    { id: 2, nom: "Farine T55 Autre Marque", reference: "REF-001", actif: false },
  ];
  const resultat = trouverArticlesCorrespondants("Farine T55", "REF-001", existants);
  assert.equal(resultat.length, 1);
  assert.equal(resultat[0].id, 1);
});

test("normaliserNomArticle : accents, casse et espaces normalisés", () => {
  assert.equal(normaliserNomArticle("Crème  Fraîche "), "creme fraiche");
  assert.equal(normaliserNomArticle("CRÈME FRAÎCHE"), "creme fraiche");
});

test("nom saisi vide -> aucune correspondance (pas de faux positif universel)", () => {
  const existants = [{ id: 1, nom: "Farine T55", reference: null, actif: true }];
  const resultat = trouverArticlesCorrespondants("   ", "", existants);
  assert.deepEqual(resultat, []);
});
