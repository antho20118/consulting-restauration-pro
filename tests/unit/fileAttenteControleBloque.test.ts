import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rattacherProductionsSynchronisees,
  traiterFile,
  type ElementFile,
} from "../../src/offline/fileAttenteCore.js";

// Point 9 de l'audit du 15/10 : un contrôle HACCP saisi hors connexion sur une production elle-même
// encore en attente (référence locale) restait bloqué POUR TOUJOURS dans la file si, au même
// passage de synchronisation, sa production était envoyée mais lui échouait (réseau coupé entre
// les deux) : la production quittait la file avec son id réel, le contrôle n'avait plus aucun
// moyen de le retrouver — jamais envoyé, jamais signalé en erreur.

const production: ElementFile = {
  idLocal: "p1",
  creeLe: 1,
  statut: "en_attente",
  action: { type: "production", idLocal: "p1", recetteId: 1, cible: { mode: "portions", valeur: 4 } },
};
const controle: ElementFile = {
  idLocal: "c1",
  creeLe: 2,
  statut: "en_attente",
  action: {
    type: "controleHaccp",
    idLocal: "c1",
    productionRef: { sorte: "local", idLocal: "p1" },
    recetteEtapeId: 10,
    valeur: "68 °C",
    conforme: true,
  },
};

// Reproduit synchroniser() (src/offline/synchronisation.ts) sur une file en mémoire.
async function passage(file: ElementFile[], echecControle: boolean, envoyes: number[]) {
  const resultat = await traiterFile(file, {
    production: async () => 42,
    controleHaccp: async (_action, productionId) => {
      if (echecControle) throw new TypeError("Failed to fetch");
      envoyes.push(productionId);
    },
  });
  const restants = file.filter((e) => !resultat.traites.includes(e.idLocal));
  const misAJour = new Map(rattacherProductionsSynchronisees(restants, resultat.idsReels).map((e) => [e.idLocal, e]));
  return restants.map((e) => misAJour.get(e.idLocal) ?? e);
}

test("production envoyée, contrôle en échec au même passage : au passage suivant, le contrôle part vers la bonne production", async () => {
  const envoyes: number[] = [];
  const apresPremier = await passage([production, controle], true, envoyes);
  assert.deepEqual(apresPremier.map((e) => e.idLocal), ["c1"]);
  const apresSecond = await passage(apresPremier, false, envoyes);
  assert.deepEqual(envoyes, [42]);
  assert.deepEqual(apresSecond, []);
});

test("rattacherProductionsSynchronisees : ne touche qu'aux contrôles des productions synchronisées", () => {
  const autre: ElementFile = { ...controle, idLocal: "c2", action: { ...controle.action, idLocal: "c2", productionRef: { sorte: "local", idLocal: "p9" } } as ElementFile["action"] };
  const misAJour = rattacherProductionsSynchronisees([controle, autre], { p1: 42 });
  assert.equal(misAJour.length, 1);
  assert.deepEqual((misAJour[0].action as { productionRef: unknown }).productionRef, { sorte: "reel", id: 42 });
  assert.deepEqual(rattacherProductionsSynchronisees([controle], {}), []);
});
