import { test } from "node:test";
import assert from "node:assert/strict";

import { analyserFactureLocal } from "../../src/features/fournisseurs/utils/analyserFactureLocal.js";
import { normaliserDateFacture } from "../../src/features/fournisseurs/utils/normaliserDateFacture.js";

// Teste les deux utilitaires purs du repli sans IA de l'import de facture par photo (Phase 6) :
// analyserFactureLocal.ts (numéro/date/montant/lignes) et normaliserDateFacture.ts (conversion vers
// le format ISO attendu par <input type="date"> et par la persistance serveur). Même discipline que
// analyseRecetteLocale.test.ts : ne jamais inventer une information non reconnue (null plutôt que
// deviner).

test("analyserFactureLocal : reconnaît numéro, date, montant total et lignes sur un texte complet", () => {
  const texte = [
    "FACTURE N: FA-2026-001",
    "Date: 15/03/2026",
    "Emmental cube 500g 6,50",
    "Beurre doux 250g 3,20",
    "Total TTC: 123,45",
  ].join("\n");

  const extraction = analyserFactureLocal(texte);
  assert.equal(extraction.numero, "FA-2026-001");
  assert.equal(extraction.dateDocument, "2026-03-15");
  assert.equal(extraction.montantTotal, 123.45);
  assert.equal(extraction.lignes.length, 2);
  assert.equal(extraction.lignes[0].designation, "Emmental cube 500g");
  assert.equal(extraction.lignes[0].prix, "6,50");
});

test("analyserFactureLocal : n'invente rien quand aucune information n'est reconnue", () => {
  const extraction = analyserFactureLocal("Ligne sans aucun format reconnaissable");
  assert.equal(extraction.numero, null);
  assert.equal(extraction.dateDocument, null);
  assert.equal(extraction.montantTotal, null);
  assert.deepEqual(extraction.lignes, []);
});

test("analyserFactureLocal : ne confond jamais un mot anglais générique avec un numéro de facture", () => {
  const extraction = analyserFactureLocal("Some random line with no invoice number info 6,50");
  assert.equal(extraction.numero, null);
});

test("analyserFactureLocal : reconnaît 'Facture n°' et 'Numéro :' comme variantes valides", () => {
  assert.equal(analyserFactureLocal("Facture n° FA-9001").numero, "FA-9001");
  assert.equal(analyserFactureLocal("Numero: 2026-055").numero, "2026-055");
});

test("normaliserDateFacture : conserve une date déjà ISO", () => {
  assert.equal(normaliserDateFacture("2026-03-15"), "2026-03-15");
});

test("normaliserDateFacture : convertit une date française JJ/MM/AAAA en ISO", () => {
  assert.equal(normaliserDateFacture("15/03/2026"), "2026-03-15");
  assert.equal(normaliserDateFacture("15-03-2026"), "2026-03-15");
  assert.equal(normaliserDateFacture("15.03.2026"), "2026-03-15");
});

test("normaliserDateFacture : renvoie null plutôt que d'inventer une date illisible", () => {
  assert.equal(normaliserDateFacture(null), null);
  assert.equal(normaliserDateFacture("date illisible"), null);
  assert.equal(normaliserDateFacture(""), null);
});
