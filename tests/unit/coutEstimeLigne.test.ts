import { test } from "node:test";
import assert from "node:assert/strict";
import { estimerCoutLigne, uniteIncompatible } from "../../src/features/recettes/utils/cout.js";
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

// Point 3 de l'audit du 15/10 : 100 g d'œufs vendus à la pièce s'affichaient à 30 € pendant
// l'édition (100 « pièces » × 0,30 €) alors que le serveur refuse cette ligne à l'enregistrement.
const GRAMME: UniteRecette = { id: 2, nom: "Gramme", symbole: "g", facteurBase: 1, type: "poids" };
const PIECE: UniteRecette = { id: 3, nom: "Pièce", symbole: "pièce", facteurBase: 1, type: "piece" };

function oeufs(): ArticleRecette {
  return {
    ...pommesDeTerre(100),
    nom: "Œufs",
    tarifs: [{ prixHT: 0.3, quantiteConditionnement: 1, unite: { symbole: "pièce", facteurBase: 1, type: "unite" }, fournisseur: { id: 1, nom: "F" } }],
  };
}

test("unité d'une autre famille que le tarif (g pour un article acheté à la pièce) : signalée, aucun coût estimé", () => {
  assert.equal(uniteIncompatible(oeufs(), GRAMME), true);
  assert.equal(estimerCoutLigne(oeufs(), 100, GRAMME), 0);
});

test("même famille (« piece » et « unite ») ou famille inconnue : pas de signalement, coût estimé normal", () => {
  assert.equal(uniteIncompatible(oeufs(), PIECE), false);
  assert.equal(estimerCoutLigne(oeufs(), 2, PIECE), 0.6);
  assert.equal(uniteIncompatible(oeufs(), KG), false);
  assert.equal(uniteIncompatible(pommesDeTerre(80), GRAMME), false);
});
