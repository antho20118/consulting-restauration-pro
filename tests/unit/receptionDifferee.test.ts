import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionReceptionDifferee } from "../../src/features/productions/utils/receptionDifferee.js";

// Affichage d'une saisie HACCP transmise en différé (voir src/features/productions/utils/receptionDifferee.ts).

test("reçue plus de 2 minutes après la saisie : les deux moments sont montrés", () => {
  const mention = mentionReceptionDifferee("2026-10-16T08:00:00.000Z", "2026-10-16T09:30:00.000Z");
  assert.match(mention ?? "", /^saisi hors connexion, reçu le /);
});

test("reçue aussitôt (saisie en ligne), ou sans heure de réception : rien à signaler", () => {
  assert.equal(mentionReceptionDifferee("2026-10-16T08:00:00.000Z", "2026-10-16T08:00:01.000Z"), null);
  assert.equal(mentionReceptionDifferee("2026-10-16T08:00:00.000Z", undefined), null);
});
