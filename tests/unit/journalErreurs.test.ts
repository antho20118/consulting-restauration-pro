import { test } from "node:test";
import assert from "node:assert/strict";

import prisma from "../../server/prisma.js";
import { journaliserErreur } from "../../server/utils/journalErreurs.js";

// Test direct de l'utilitaire (pas de serveur HTTP ici) : voir tests/unit/journalErreursRoute.test.ts
// pour les routes qui l'exposent, et tests/unit/gestionnaireErreurGlobal.test.ts pour le filet de
// sécurité Express qui l'appelle en cas d'erreur non interceptée par un routeur.

test("journaliserErreur enregistre le message, la pile et le contexte fournis", async () => {
  const erreur = new Error("Erreur de test journalErreurs");
  await journaliserErreur(erreur, "SERVEUR", {
    methode: "GET",
    route: "/api/test-journal",
    statutHttp: 500,
    societeId: null,
    utilisateurId: null,
  });

  const entree = await prisma.journalErreur.findFirst({
    where: { message: "Erreur de test journalErreurs" },
    orderBy: { id: "desc" },
  });
  assert.ok(entree);
  assert.equal(entree!.origine, "SERVEUR");
  assert.equal(entree!.methode, "GET");
  assert.equal(entree!.route, "/api/test-journal");
  assert.equal(entree!.statutHttp, 500);
  assert.ok(entree!.pile);

  await prisma.journalErreur.delete({ where: { id: entree!.id } });
});

test("journaliserErreur accepte une valeur qui n'est pas une vraie instance d'Error, sans jamais planter l'appelant", async () => {
  await assert.doesNotReject(() => journaliserErreur("panne brute", "CLIENT", {}));

  const entree = await prisma.journalErreur.findFirst({
    where: { message: "panne brute" },
    orderBy: { id: "desc" },
  });
  assert.ok(entree);
  assert.equal(entree!.origine, "CLIENT");
  assert.equal(entree!.pile, null);

  await prisma.journalErreur.delete({ where: { id: entree!.id } });
});

test("le journal reste plafonné : les entrées les plus anciennes sont purgées au-delà de 500 lignes", async () => {
  // Isolation : ce test raisonne sur le total exact de lignes en base, donc repart d'une table vide
  // plutôt que de composer avec un total imprévisible laissé par d'autres tests/l'usage réel.
  await prisma.journalErreur.deleteMany({});

  const base = Date.now() - 1000 * 60 * 60 * 24; // hier, pour ne jamais chevaucher l'entrée créée après
  const donnees = Array.from({ length: 550 }, (_, i) => ({
    origine: "SERVEUR" as const,
    message: `ancienne-${i}`,
    moment: new Date(base + i * 1000),
  }));
  await prisma.journalErreur.createMany({ data: donnees });

  await journaliserErreur(new Error("la plus récente"), "SERVEUR", {});

  const total = await prisma.journalErreur.count();
  assert.ok(total <= 500, `attendu au plus 500 lignes après purge, obtenu ${total}`);

  const ancienneEncorePresente = await prisma.journalErreur.findFirst({
    where: { message: "ancienne-0" },
  });
  assert.equal(ancienneEncorePresente, null);

  const recente = await prisma.journalErreur.findFirst({ where: { message: "la plus récente" } });
  assert.ok(recente);

  await prisma.journalErreur.deleteMany({});
});
