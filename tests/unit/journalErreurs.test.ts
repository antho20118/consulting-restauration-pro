import { randomUUID } from "node:crypto";
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
  // Jamais de deleteMany({}) sur toute la table : `npm test` exécute les autres fichiers en
  // parallèle sur la même base, et beaucoup lisent/suppriment leurs propres entrées JournalErreur —
  // vider la table effaçait aussi les leurs (et tout le journal de diagnostic d'une base locale).
  // À la place, 550 entrées marquées et datées de l'an 2000 : toujours les plus anciennes, ce sont
  // donc elles, et elles seules, que la purge supprime en premier.
  const marqueur = `plafond-${randomUUID()}`;
  const base = new Date("2000-01-01T00:00:00Z").getTime();
  const donnees = Array.from({ length: 550 }, (_, i) => ({
    origine: "SERVEUR" as const,
    message: `${marqueur}-ancienne-${i}`,
    moment: new Date(base + i * 1000),
  }));
  await prisma.journalErreur.createMany({ data: donnees });

  const messageRecent = `${marqueur}-la-plus-recente`;
  try {
    await journaliserErreur(new Error(messageRecent), "SERVEUR", {});

    const recente = await prisma.journalErreur.findFirst({ where: { message: messageRecent } });
    assert.ok(recente, "l'entrée qui vient d'être journalisée n'est jamais purgée");

    // Plafond vérifié sans dépendre des écritures concurrentes : seules les entrées créées APRÈS la
    // nôtre (id supérieur, donc par d'autres fichiers après notre purge) peuvent légitimement faire
    // dépasser 500 au moment de ce comptage ; les suppressions concurrentes ne font que le réduire.
    const total = await prisma.journalErreur.count();
    const creeesApres = await prisma.journalErreur.count({ where: { id: { gt: recente!.id } } });
    assert.ok(total - creeesApres <= 500, `attendu au plus 500 lignes après purge, obtenu ${total - creeesApres}`);

    // Les plus anciennes sont purgées les premières : la toute première a disparu, et celles qui
    // restent forment bien la fin de la série (jamais un « trou » au milieu).
    const restantes = await prisma.journalErreur.findMany({
      where: { message: { startsWith: `${marqueur}-ancienne-` } },
      select: { message: true },
    });
    const indices = restantes.map((e) => Number(e.message.slice(`${marqueur}-ancienne-`.length))).sort((a, b) => a - b);
    assert.ok(indices.length < 550, "au moins une entrée ancienne doit avoir été purgée");
    assert.ok(!indices.includes(0), "la plus ancienne entrée doit avoir été purgée");
    if (indices.length > 0) {
      assert.deepEqual(indices, Array.from({ length: indices.length }, (_, k) => 550 - indices.length + k));
    }
  } finally {
    await prisma.journalErreur.deleteMany({ where: { message: { startsWith: marqueur } } });
  }
});
