import { test } from "node:test";
import assert from "node:assert/strict";
import { fusionnerTarifsGroupe } from "../../src/features/fournisseurs/utils/regrouperTarifs.js";
import type { Fournisseur } from "../../src/features/fournisseurs/types/fournisseur.js";
import type { TarifFournisseur } from "../../src/features/fournisseurs/services/fournisseurService.js";

// Teste src/features/fournisseurs/utils/regrouperTarifs.ts — chantier « regroupement des tarifs
// homonymes » (niveau 3 de la vue groupée, voir SelecteurFournisseurHomonyme.tsx). Aucune écriture
// en base, aucune fusion : chaque tarif doit rester rattaché à son fournisseur physique d'origine.

let prochainFournisseurId = 1;
let prochainTarifId = 1;

function fournisseur(partiel: Partial<Fournisseur> & { nom: string }): Fournisseur {
  return { id: prochainFournisseurId++, telephone: null, email: null, siteWeb: null, ...partiel };
}

function tarif(partiel: Partial<TarifFournisseur> & { articleId: number; prixHT: number }): TarifFournisseur {
  return {
    id: prochainTarifId++,
    quantiteConditionnement: 1,
    dateDebut: "2024-01-01T00:00:00.000Z",
    dateFin: null,
    actif: true,
    article: { id: partiel.articleId, nom: `Article ${partiel.articleId}`, reference: null },
    unite: { symbole: "kg" },
    conditionnement: { nom: "Sac" },
    ligneDocumentSource: null,
    ...partiel,
  };
}

test("D. les tarifs des deux fournisseurs sont tous présents dans la vue regroupée", () => {
  const a = fournisseur({ nom: "METRO" });
  const b = fournisseur({ nom: "METRO" });
  const tarifA = tarif({ articleId: 1, prixHT: 6.2 });
  const tarifB = tarif({ articleId: 2, prixHT: 7.2 });

  const fusion = fusionnerTarifsGroupe([
    { fournisseur: a, tarifs: [tarifA] },
    { fournisseur: b, tarifs: [tarifB] },
  ]);

  assert.equal(fusion.length, 2);
  assert.ok(fusion.some((t) => t.id === tarifA.id));
  assert.ok(fusion.some((t) => t.id === tarifB.id));
});

test("E. deux tarifs sur le même article venant de deux fournisseurs différents ne sont jamais fusionnés ni écrasés", () => {
  const a = fournisseur({ nom: "METRO", telephone: "0611111111" });
  const b = fournisseur({ nom: "METRO", telephone: "0622222222" });
  const tarifA = tarif({ articleId: 1, prixHT: 6.2 });
  const tarifB = tarif({ articleId: 1, prixHT: 5.95 }); // même article, prix différent

  const fusion = fusionnerTarifsGroupe([
    { fournisseur: a, tarifs: [tarifA] },
    { fournisseur: b, tarifs: [tarifB] },
  ]);

  assert.equal(fusion.length, 2, "les deux tarifs sur le même article doivent rester deux lignes distinctes");
  const ligneA = fusion.find((t) => t.id === tarifA.id);
  const ligneB = fusion.find((t) => t.id === tarifB.id);
  assert.equal(ligneA?.prixHT, 6.2);
  assert.equal(ligneB?.prixHT, 5.95);
});

test("F. chaque tarif permet d'identifier son fournisseur physique d'origine", () => {
  const a = fournisseur({ nom: "METRO", telephone: "0611111111" });
  const b = fournisseur({ nom: "METRO", telephone: "0622222222" });
  const tarifA = tarif({ articleId: 1, prixHT: 6.2 });
  const tarifB = tarif({ articleId: 1, prixHT: 5.95 });

  const fusion = fusionnerTarifsGroupe([
    { fournisseur: a, tarifs: [tarifA] },
    { fournisseur: b, tarifs: [tarifB] },
  ]);

  const ligneA = fusion.find((t) => t.id === tarifA.id);
  const ligneB = fusion.find((t) => t.id === tarifB.id);
  assert.equal(ligneA?.fournisseurOrigine.id, a.id);
  assert.equal(ligneA?.fournisseurOrigine.telephone, "0611111111");
  assert.equal(ligneB?.fournisseurOrigine.id, b.id);
  assert.equal(ligneB?.fournisseurOrigine.telephone, "0622222222");
});

test("G. un fournisseur ayant plusieurs tarifs conserve tous ses tarifs dans la fusion", () => {
  const a = fournisseur({ nom: "METRO" });
  const poulet = tarif({ articleId: 1, prixHT: 6.2 });
  const creme = tarif({ articleId: 2, prixHT: 4.8 });

  const fusion = fusionnerTarifsGroupe([{ fournisseur: a, tarifs: [poulet, creme] }]);

  assert.equal(fusion.length, 2);
  assert.ok(fusion.some((t) => t.id === poulet.id));
  assert.ok(fusion.some((t) => t.id === creme.id));
});

test("H. un fournisseur sans tarif ne fait disparaître ni ses propres tarifs (il n'en a pas) ni ceux des autres", () => {
  const a = fournisseur({ nom: "METRO" });
  const b = fournisseur({ nom: "METRO" }); // sans aucun tarif
  const c = fournisseur({ nom: "METRO" });
  const tarifA = tarif({ articleId: 1, prixHT: 6.2 });
  const tarifC = tarif({ articleId: 2, prixHT: 3.1 });

  const fusion = fusionnerTarifsGroupe([
    { fournisseur: a, tarifs: [tarifA] },
    { fournisseur: b, tarifs: [] },
    { fournisseur: c, tarifs: [tarifC] },
  ]);

  assert.equal(fusion.length, 2, "b ne contribue aucune ligne mais ne doit pas affecter celles de a et c");
  assert.ok(fusion.some((t) => t.id === tarifA.id));
  assert.ok(fusion.some((t) => t.id === tarifC.id));
});

test("exemple du cadrage : Poulet A/B, Crème A, Beurre B — 4 lignes distinctes, aucun écrasement", () => {
  const a = fournisseur({ nom: "METRO", telephone: "0611111111" });
  const b = fournisseur({ nom: "METRO", telephone: "0622222222" });
  const pouletA = tarif({ articleId: 1, prixHT: 6.2 });
  const cremeA = tarif({ articleId: 2, prixHT: 4.8 });
  const pouletB = tarif({ articleId: 1, prixHT: 5.95 });
  const beurreB = tarif({ articleId: 3, prixHT: 7.2 });

  const fusion = fusionnerTarifsGroupe([
    { fournisseur: a, tarifs: [pouletA, cremeA] },
    { fournisseur: b, tarifs: [pouletB, beurreB] },
  ]);

  assert.equal(fusion.length, 4);
  assert.equal(fusion.find((t) => t.id === pouletA.id)?.fournisseurOrigine.id, a.id);
  assert.equal(fusion.find((t) => t.id === pouletB.id)?.fournisseurOrigine.id, b.id);
  assert.equal(fusion.find((t) => t.id === cremeA.id)?.fournisseurOrigine.id, a.id);
  assert.equal(fusion.find((t) => t.id === beurreB.id)?.fournisseurOrigine.id, b.id);
});
