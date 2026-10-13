import { test } from "node:test";
import assert from "node:assert/strict";
import { correspondancesAMemoriser } from "../../src/features/recettes/utils/correspondancesIngredients.js";
import type { LigneRecetteInput } from "../../src/features/recettes/types/recette.js";

// Voir src/features/recettes/utils/correspondancesIngredients.ts. Une correspondance mémorisée
// prime ensuite sur toute recherche lors des imports suivants (voir trouverArticle dans
// ligneImportee.ts) : seul un rattachement choisi ou revu par l'utilisateur doit l'alimenter,
// jamais un rapprochement automatique laissé « à confirmer » (constaté en e2e : un rattachement
// automatique faux, enregistré sans confirmation, était mémorisé puis reproduit à chaque import).

function ligne(partiel: Partial<LigneRecetteInput>): LigneRecetteInput {
  return { articleId: 0, articleConfirme: true, quantite: 1, uniteId: 1, gainCuissonPct: 0, ...partiel };
}

test("ligne importée, article confirmé par l'utilisateur : mémorisée", () => {
  assert.deepEqual(
    correspondancesAMemoriser([ligne({ texteIngredientImporte: "sucre", articleId: 7, articleConfirme: true })]),
    [{ texte: "sucre", articleId: 7 }]
  );
});

test("ligne importée, rapprochement automatique non confirmé : jamais mémorisée", () => {
  assert.deepEqual(
    correspondancesAMemoriser([ligne({ texteIngredientImporte: "sucre", articleId: 7, articleConfirme: false })]),
    []
  );
});

test("ligne sans article, ou ajoutée à la main (sans texte importé) : jamais mémorisée", () => {
  assert.deepEqual(
    correspondancesAMemoriser([
      ligne({ texteIngredientImporte: "farine", articleId: 0, articleConfirme: true }),
      ligne({ articleId: 9, articleConfirme: true }),
    ]),
    []
  );
});

test("mélange : seules les lignes importées et confirmées sont retenues, dans l'ordre", () => {
  assert.deepEqual(
    correspondancesAMemoriser([
      ligne({ texteIngredientImporte: "beurre", articleId: 3, articleConfirme: true }),
      ligne({ texteIngredientImporte: "sucre", articleId: 7, articleConfirme: false }),
      ligne({ texteIngredientImporte: "fouet", articleId: 11, articleConfirme: true }),
    ]),
    [
      { texte: "beurre", articleId: 3 },
      { texte: "fouet", articleId: 11 },
    ]
  );
});
