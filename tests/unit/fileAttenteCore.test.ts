import { test } from "node:test";
import assert from "node:assert/strict";
import { traiterFile, type ElementFile, type ReferenceProduction } from "../../src/offline/fileAttenteCore.js";

// Logique pure de la file d'attente hors ligne (voir src/offline/fileAttenteCore.ts) — testée ici
// avec de simples exécuteurs en mémoire, sans IndexedDB ni réseau réel (voir
// src/offline/fileAttenteDb.ts et synchronisation.ts pour l'adaptateur réel, non testés
// unitairement puisqu'ils dépendent d'API navigateur, même principe que ocrPhoto.ts).

function elementProduction(idLocal: string, creeLe: number): ElementFile {
  return {
    idLocal,
    creeLe,
    statut: "en_attente",
    action: { type: "production", idLocal, recetteId: 1, cible: { mode: "portions", valeur: 4 } },
  };
}

function elementControle(idLocal: string, creeLe: number, productionRef: ReferenceProduction): ElementFile {
  return {
    idLocal,
    creeLe,
    statut: "en_attente",
    action: {
      type: "controleHaccp",
      idLocal,
      productionRef,
      recetteEtapeId: 10,
      valeur: "68°C",
      conforme: true,
    },
  };
}

test("une production réussie est retirée de la file et son id réel est exposé", async () => {
  const elements = [elementProduction("p1", 1)];
  const resultat = await traiterFile(elements, {
    production: async () => 42,
    controleHaccp: async () => {},
  });
  assert.deepEqual(resultat.traites, ["p1"]);
  assert.deepEqual(resultat.idsReels, { p1: 42 });
  assert.deepEqual(resultat.echecs, []);
});

test("une production en échec reste en file, marquée en erreur, sans bloquer les suivantes", async () => {
  const elements = [elementProduction("p1", 1), elementProduction("p2", 2)];
  const resultat = await traiterFile(elements, {
    production: async (action) => {
      if (action.idLocal === "p1") throw new Error("Hors ligne");
      return 99;
    },
    controleHaccp: async () => {},
  });
  assert.deepEqual(resultat.traites, ["p2"]);
  assert.deepEqual(resultat.idsReels, { p2: 99 });
  assert.equal(resultat.echecs.length, 1);
  assert.equal(resultat.echecs[0].idLocal, "p1");
  assert.equal(resultat.echecs[0].erreur, "Hors ligne");
});

test("un contrôle référençant une production déjà synchronisée (id réel) est traité normalement", async () => {
  const elements = [elementControle("c1", 1, { sorte: "reel", id: 7 })];
  const appelsRecus: number[] = [];
  const resultat = await traiterFile(elements, {
    production: async () => {
      throw new Error("ne devrait jamais être appelé");
    },
    controleHaccp: async (_action, productionId) => {
      appelsRecus.push(productionId);
    },
  });
  assert.deepEqual(resultat.traites, ["c1"]);
  assert.deepEqual(appelsRecus, [7]);
});

test("un contrôle référençant une production locale synchronisée DANS LE MÊME PASSAGE est résolu avec le bon id", async () => {
  const elements = [elementProduction("p1", 1), elementControle("c1", 2, { sorte: "local", idLocal: "p1" })];
  const appelsRecus: number[] = [];
  const resultat = await traiterFile(elements, {
    production: async () => 55,
    controleHaccp: async (_action, productionId) => {
      appelsRecus.push(productionId);
    },
  });
  assert.deepEqual(resultat.traites, ["p1", "c1"]);
  assert.deepEqual(appelsRecus, [55]);
});

test("un contrôle référençant une production locale dont la synchronisation échoue reste en attente, jamais tenté avec un id inventé", async () => {
  const elements = [elementProduction("p1", 1), elementControle("c1", 2, { sorte: "local", idLocal: "p1" })];
  let controleAppele = false;
  const resultat = await traiterFile(elements, {
    production: async () => {
      throw new Error("Hors ligne");
    },
    controleHaccp: async () => {
      controleAppele = true;
    },
  });
  assert.equal(controleAppele, false);
  assert.deepEqual(resultat.traites, []);
  assert.equal(resultat.echecs.length, 1);
  assert.equal(resultat.echecs[0].idLocal, "p1");
  // Le contrôle n'apparaît ni dans traites ni dans echecs : il n'a simplement pas encore été
  // tenté, retenu pour le prochain passage.
});

test("un contrôle en échec reste en file (marqué en erreur), sans affecter les autres éléments", async () => {
  const elements = [elementControle("c1", 1, { sorte: "reel", id: 1 }), elementControle("c2", 2, { sorte: "reel", id: 2 })];
  const resultat = await traiterFile(elements, {
    production: async () => {
      throw new Error("ne devrait jamais être appelé");
    },
    controleHaccp: async (action) => {
      if (action.idLocal === "c1") throw new Error("Erreur serveur");
    },
  });
  assert.deepEqual(resultat.traites, ["c2"]);
  assert.equal(resultat.echecs.length, 1);
  assert.equal(resultat.echecs[0].idLocal, "c1");
});

test("file vide : aucun traitement, aucune erreur", async () => {
  const resultat = await traiterFile([], {
    production: async () => {
      throw new Error("ne devrait jamais être appelé");
    },
    controleHaccp: async () => {
      throw new Error("ne devrait jamais être appelé");
    },
  });
  assert.deepEqual(resultat, { traites: [], idsReels: {}, echecs: [] });
});
