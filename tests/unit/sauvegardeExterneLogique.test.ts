import { test } from "node:test";
import assert from "node:assert/strict";
import { dateSauvegardeBase, mensuelleDue, nomMensuelle, nomQuotidienne } from "../../server/utils/sauvegardeExterne/nommage.js";
import { doitSauvegarder } from "../../server/utils/sauvegardeExterne/planification.js";

// Sauvegarde hors de Railway (point 1 de l'audit du 15/10) : une par nuit (calendrier de Paris),
// rattrapée si manquée ; rangée dans « quotidiennes » et, la première du mois, aussi dans
// « mensuelles » — la conservation de chaque dossier est assurée par l'hébergeur (voir nommage.ts).
// Logique pure ici ; la chaîne complète est couverte par sauvegardeExterne.test.ts.

test("noms : quotidienne et mensuelle relisibles ; noms étrangers ignorés", () => {
  const le = new Date("2026-10-30T02:05:00.000Z");
  assert.equal(nomQuotidienne(le), "base/quotidiennes/sauvegarde-2026-10-30T02-05-00-000Z.json.gz.chiffre");
  assert.equal(nomMensuelle(le), "base/mensuelles/sauvegarde-2026-10-30T02-05-00-000Z.json.gz.chiffre");
  assert.equal(dateSauvegardeBase(nomQuotidienne(le))?.toISOString(), le.toISOString());
  assert.equal(dateSauvegardeBase(nomMensuelle(le))?.toISOString(), le.toISOString());
  assert.equal(dateSauvegardeBase("base/autre/sauvegarde-2026-10-30T02-05-00-000Z.json.gz.chiffre"), null);
  assert.equal(dateSauvegardeBase("base/quotidiennes/notes.txt"), null);
});

test("mensuelle : due tant qu'aucune n'existe pour le mois en cours, jamais deux pour un même mois", () => {
  const novembre = new Date("2026-11-01T02:05:00Z");
  assert.equal(mensuelleDue([], novembre), true);
  assert.equal(mensuelleDue([nomMensuelle(new Date("2026-10-01T02:05:00Z"))], novembre), true, "celle d'octobre ne compte pas");
  assert.equal(mensuelleDue([nomMensuelle(novembre)], new Date("2026-11-02T02:05:00Z")), false);
  assert.equal(mensuelleDue([nomMensuelle(novembre)], new Date("2026-11-30T02:05:00Z")), false);
});

test("planification : une sauvegarde par nuit, à partir de 3 h (heure de Paris), rattrapée si manquée", () => {
  // 30/10/2026 : heure d'hiver, Paris = UTC+1.
  assert.equal(doitSauvegarder(new Date("2026-10-30T01:30:00Z"), new Date("2026-10-29T02:10:00Z")), false, "2 h 30 à Paris : trop tôt");
  assert.equal(doitSauvegarder(new Date("2026-10-30T02:05:00Z"), new Date("2026-10-29T02:10:00Z")), true, "3 h 05 à Paris");
  assert.equal(doitSauvegarder(new Date("2026-10-30T15:00:00Z"), new Date("2026-10-30T02:10:00Z")), false, "déjà faite aujourd'hui");
  assert.equal(doitSauvegarder(new Date("2026-10-30T15:00:00Z"), new Date("2026-10-28T02:10:00Z")), true, "nuit manquée : rattrapée");
  assert.equal(doitSauvegarder(new Date("2026-10-30T01:00:00Z"), new Date("2026-10-28T02:10:00Z")), true, "2 h à Paris, mais la nuit d'hier a été manquée : tout de suite");
  assert.equal(doitSauvegarder(new Date("2026-10-30T01:00:00Z"), null), true, "aucune sauvegarde encore : tout de suite");
  // Été (UTC+2) : 3 h à Paris = 1 h UTC.
  assert.equal(doitSauvegarder(new Date("2026-07-15T01:05:00Z"), new Date("2026-07-14T01:10:00Z")), true);
  assert.equal(doitSauvegarder(new Date("2026-07-15T00:55:00Z"), new Date("2026-07-14T01:10:00Z")), false);
});
