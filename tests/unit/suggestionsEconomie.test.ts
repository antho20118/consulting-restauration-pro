import test from "node:test";
import assert from "node:assert/strict";
import { coutEffectifParUniteBase, type ArticleAvecTarif } from "../../server/utils/suggestionsEconomie.js";

function article(overrides: Partial<ArticleAvecTarif> = {}): ArticleAvecTarif {
  return {
    id: 1,
    nom: "Article test",
    categorieId: 1,
    rendement: 100,
    tarifs: [{ prixHT: 65, quantiteConditionnement: 10, unite: { facteurBase: 1000 } }],
    ...overrides,
  };
}

test("calcule le coût effectif par unité de base en tenant compte du rendement", () => {
  // 65€ / (10 * 1000) = 0.0065 €/g ; rendement 80% => / 0.8
  const resultat = coutEffectifParUniteBase(article({ rendement: 80 }));
  assert.equal(resultat, 0.0065 / 0.8);
});

test("retourne null pour un article sans tarif actif", () => {
  assert.equal(coutEffectifParUniteBase(article({ tarifs: [] })), null);
});

test("retourne null pour un rendement invalide (0) plutôt que de retomber sur 100% par défaut", () => {
  // Avant correction, `article.rendement || 100` aurait silencieusement traité ce candidat comme
  // ayant un rendement de 100%, faussant sa comparaison avec les autres candidats de substitution.
  assert.equal(coutEffectifParUniteBase(article({ rendement: 0 })), null);
});

test("retourne null pour un rendement négatif", () => {
  assert.equal(coutEffectifParUniteBase(article({ rendement: -10 })), null);
});

test("accepte un rendement de 100 (nominal)", () => {
  assert.notEqual(coutEffectifParUniteBase(article({ rendement: 100 })), null);
});

test("accepte un rendement de 1000 (borne haute incluse, même borne que rendementValide() dans coutRecette.ts)", () => {
  assert.notEqual(coutEffectifParUniteBase(article({ rendement: 1000 })), null);
});

test("retourne null pour un rendement de 1001 (juste au-dessus de la borne haute)", () => {
  assert.equal(coutEffectifParUniteBase(article({ rendement: 1001 })), null);
});

test("retourne null pour un rendement de 5000 plutôt que de produire un coût effectif artificiellement bas", () => {
  // C'est exactement le scénario relevé par l'audit : sans cette borne haute, un article au
  // rendement aberrant (saisi à 5000 au lieu de 100, par erreur) obtenait un coût effectif très
  // bas et pouvait être suggéré comme substitution moins chère sur la seule foi d'une donnée
  // corrompue, sans jamais être écarté.
  assert.equal(coutEffectifParUniteBase(article({ rendement: 5000 })), null);
});
