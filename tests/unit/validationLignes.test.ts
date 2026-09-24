import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerAllergenesAvecStatut, ligneIncomplete } from "../../src/features/recettes/utils/validationLignes.js";
import type { ArticleRecette, LigneRecetteInput } from "../../src/features/recettes/types/recette.js";

// Teste src/features/recettes/utils/validationLignes.ts — voir PR #61 (audit import IA) :
// - ligneIncomplete() est ce qui bloque désormais l'enregistrement d'une recette tant qu'une
//   unité importée n'a pas été déterminée (fini le repli silencieux sur le kg) ;
// - calculerAllergenesAvecStatut() signale quand la liste d'allergènes affichée s'appuie sur un
//   article pas encore confirmé — le test de sécurité métier demandé par l'audit.

function ligne(partiel: Partial<LigneRecetteInput>): LigneRecetteInput {
  return { articleId: 1, articleConfirme: true, quantite: 1, uniteId: 1, gainCuissonPct: 0, ...partiel };
}

function articleAvecAllergenes(id: number, ...allergenes: { id: number; nom: string }[]): ArticleRecette {
  return {
    id,
    nom: `Article ${id}`,
    reference: null,
    rendement: 100,
    type: "MATIERE_PREMIERE",
    tarifs: [],
    allergenes: allergenes.map((allergene) => ({ allergene })),
  };
}

test("ligneIncomplete : ligne complète → null", () => {
  assert.equal(ligneIncomplete(ligne({ articleId: 5, uniteId: 10 })), null);
});

test("ligneIncomplete : article manquant (id 0) → 'article'", () => {
  assert.equal(ligneIncomplete(ligne({ articleId: 0, uniteId: 10 })), "article");
});

test("ligneIncomplete : unité manquante (id 0, ex. import IA sans unité reconnue) → 'unite'", () => {
  assert.equal(ligneIncomplete(ligne({ articleId: 5, uniteId: 0 })), "unite");
});

test("ligneIncomplete : article manquant prioritaire si les deux manquent", () => {
  assert.equal(ligneIncomplete(ligne({ articleId: 0, uniteId: 0 })), "article");
});

test("calculerAllergenesAvecStatut : union des allergènes de toutes les lignes, triée", () => {
  const gluten = { id: 1, nom: "Gluten" };
  const lait = { id: 2, nom: "Lait" };
  const articles = [articleAvecAllergenes(10, gluten), articleAvecAllergenes(20, lait)];
  const lignes = [ligne({ articleId: 10 }), ligne({ articleId: 20 })];

  const { allergenes, incertain } = calculerAllergenesAvecStatut(lignes, articles);

  assert.deepEqual(allergenes, [gluten, lait]);
  assert.equal(incertain, false);
});

test("calculerAllergenesAvecStatut : ligne sans article sélectionné → ignorée (aucun allergène, pas d'incertitude)", () => {
  const { allergenes, incertain } = calculerAllergenesAvecStatut([ligne({ articleId: 0 })], []);
  assert.deepEqual(allergenes, []);
  assert.equal(incertain, false);
});

// Le test de sécurité demandé par l'audit : un article rapproché automatiquement (pas encore
// confirmé) contribue toujours aux allergènes affichés (on ne les cache pas — ils restent la
// meilleure information disponible), mais la liste doit être signalée comme incertaine tant que
// l'utilisateur n'a pas validé cet article.
test("calculerAllergenesAvecStatut : article auto-rapproché non confirmé → allergènes affichés MAIS incertain=true", () => {
  const gluten = { id: 1, nom: "Gluten" };
  const articles = [articleAvecAllergenes(10, gluten)];
  const lignes = [ligne({ articleId: 10, articleConfirme: false })];

  const { allergenes, incertain } = calculerAllergenesAvecStatut(lignes, articles);

  assert.deepEqual(allergenes, [gluten]);
  assert.equal(incertain, true);
});

test("calculerAllergenesAvecStatut : un seul article non confirmé parmi plusieurs suffit à signaler l'incertitude", () => {
  const gluten = { id: 1, nom: "Gluten" };
  const lait = { id: 2, nom: "Lait" };
  const articles = [articleAvecAllergenes(10, gluten), articleAvecAllergenes(20, lait)];
  const lignes = [
    ligne({ articleId: 10, articleConfirme: true }),
    ligne({ articleId: 20, articleConfirme: false }),
  ];

  const { incertain } = calculerAllergenesAvecStatut(lignes, articles);

  assert.equal(incertain, true);
});

test("calculerAllergenesAvecStatut : tous les articles confirmés → incertain=false", () => {
  const gluten = { id: 1, nom: "Gluten" };
  const articles = [articleAvecAllergenes(10, gluten)];
  const lignes = [ligne({ articleId: 10, articleConfirme: true })];

  const { incertain } = calculerAllergenesAvecStatut(lignes, articles);

  assert.equal(incertain, false);
});
