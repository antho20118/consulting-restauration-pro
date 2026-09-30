import { test } from "node:test";
import assert from "node:assert/strict";

import {
  rapprocherLigneVente,
  type ContexteRapprochementVente,
  type CandidatRecetteVente,
} from "../../server/utils/rapprochementVentes.js";

// Test unitaire pur (aucune base, aucun serveur) du moteur de rapprochement produit vendu ->
// recette — voir server/utils/rapprochementVentes.ts. Priorité ALIAS -> DESIGNATION_EXACTE ->
// DESIGNATION_APPROXIMATIVE (Jaccard), jamais de CODE_ARTICLE/REFERENCE_FOURNISSEUR (une Recette
// n'a ni code ni référence, contrairement à un Article).

function contexte(candidats: CandidatRecetteVente[], alias: [string, number][] = []): ContexteRapprochementVente {
  return { candidats, aliasParTexteNormalise: new Map(alias) };
}

test("certaine (ALIAS) : un alias déjà appris gagne même si une autre recette a un nom plus proche", () => {
  const ctx = contexte(
    [
      { recetteId: 1, nom: "Burger classique" },
      { recetteId: 2, nom: "Burger cheese" },
    ],
    [["burger maison", 1]]
  );
  const resultat = rapprocherLigneVente("Burger Maison", ctx);
  assert.deepEqual(resultat, { cas: "certaine", recetteId: 1, motif: "ALIAS" });
});

test("certaine (DESIGNATION_EXACTE) : désignation normalisée strictement identique au nom d'une recette, sans alias", () => {
  const ctx = contexte([{ recetteId: 1, nom: "Salade César" }]);
  const resultat = rapprocherLigneVente("salade cesar", ctx);
  assert.deepEqual(resultat, { cas: "certaine", recetteId: 1, motif: "DESIGNATION_EXACTE" });
});

test("approximative_unique : un seul candidat au-dessus du seuil, aucune désignation exacte ni alias", () => {
  const ctx = contexte([{ recetteId: 1, nom: "Tarte aux pommes maison" }]);
  const resultat = rapprocherLigneVente("Tarte pommes", ctx);
  assert.equal(resultat.cas, "approximative_unique");
  assert.equal((resultat as { recetteId: number }).recetteId, 1);
});

test("plusieurs_candidats : deux recettes au-dessus du seuil, triées par score décroissant", () => {
  const ctx = contexte([
    { recetteId: 1, nom: "Poulet rôti frites" },
    { recetteId: 2, nom: "Poulet rôti légumes" },
  ]);
  const resultat = rapprocherLigneVente("Poulet rôti", ctx);
  assert.equal(resultat.cas, "plusieurs_candidats");
  if (resultat.cas === "plusieurs_candidats") {
    assert.equal(resultat.candidats.length, 2);
    assert.ok(resultat.candidats[0].score >= resultat.candidats[1].score);
  }
});

test("aucun_candidat : aucune recette suivie ne s'approche de la désignation lue (boisson, à la carte non fichée)", () => {
  const ctx = contexte([{ recetteId: 1, nom: "Blanquette de veau" }]);
  const resultat = rapprocherLigneVente("Coca-Cola 33cl", ctx);
  assert.deepEqual(resultat, { cas: "aucun_candidat" });
});

test("un alias appris pour une désignation ne s'applique pas à une désignation différente", () => {
  const ctx = contexte([{ recetteId: 1, nom: "Burger classique" }], [["cheeseburger", 1]]);
  const resultat = rapprocherLigneVente("Burger classique", ctx);
  // Pas d'alias pour cette désignation précise, mais désignation exacte : reste "certaine".
  assert.deepEqual(resultat, { cas: "certaine", recetteId: 1, motif: "DESIGNATION_EXACTE" });
});

test("l'alias prime sur la désignation exacte quand les deux pointent vers des recettes différentes", () => {
  const ctx = contexte(
    [
      { recetteId: 1, nom: "Menu Enfant" },
      { recetteId: 2, nom: "Menu Enfant Frites" },
    ],
    [["menu enfant", 2]]
  );
  const resultat = rapprocherLigneVente("Menu Enfant", ctx);
  assert.deepEqual(resultat, { cas: "certaine", recetteId: 2, motif: "ALIAS" });
});
