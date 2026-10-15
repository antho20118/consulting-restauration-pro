import { test } from "node:test";
import assert from "node:assert/strict";
import { estimerCoutLigne } from "../../src/features/recettes/utils/cout.js";
import type { ArticleRecette, UniteRecette } from "../../src/features/recettes/types/recette.js";

// Coût estimé d'une ligne pendant l'édition d'une recette (src/features/recettes/utils/cout.ts) : doit
// suivre exactement la convention du serveur (calculerCoutRecette) — quantité saisie = poids BRUT
// acheté, coût = quantité × prix, jamais divisé par le rendement (décision métier du 15/10).

const KG: UniteRecette = { id: 1, nom: "Kilogramme", symbole: "kg", facteurBase: 1000 };

function pommesDeTerre(rendement: number): ArticleRecette {
  return {
    id: 1,
    nom: "Pommes de terre",
    reference: null,
    rendement,
    type: "MATIERE_PREMIERE",
    tarifs: [{ prixHT: 10, quantiteConditionnement: 1, unite: { symbole: "kg", facteurBase: 1000 }, fournisseur: { id: 1, nom: "F" } }],
    allergenes: [],
  };
}

test("1 kg de pommes de terre à 10 €/kg coûte 10 €, quel que soit le rendement", () => {
  assert.equal(estimerCoutLigne(pommesDeTerre(100), 1, KG), 10);
  assert.equal(estimerCoutLigne(pommesDeTerre(80), 1, KG), 10);
});

test("sans tarif ou sans unité : 0 (rien à estimer)", () => {
  assert.equal(estimerCoutLigne({ ...pommesDeTerre(80), tarifs: [] }, 1, KG), 0);
  assert.equal(estimerCoutLigne(pommesDeTerre(80), 1, undefined), 0);
});
