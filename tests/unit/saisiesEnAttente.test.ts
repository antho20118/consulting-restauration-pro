import { test } from "node:test";
import assert from "node:assert/strict";
import { etatSaisie, libelleSaisie, saisiesAAbandonner, type ElementFile } from "../../src/offline/fileAttenteCore.js";

// Saisies faites hors connexion (src/offline/) : jusqu'ici, une saisie refusée par le serveur au
// retour du réseau (recette supprimée entre-temps, saisie de plus de 7 jours…) restait en file pour
// toujours, renvoyée à chaque synchronisation, sans que personne ne voie ni le motif du refus ni un
// moyen d'en sortir — seul un compteur « N actions en attente » restait affiché. Les contrôles HACCP
// rattachés à une production refusée restaient bloqués avec elle.

function production(idLocal: string, extra: Partial<ElementFile> = {}): ElementFile {
  return {
    idLocal,
    action: { type: "production", idLocal, recetteId: 12, cible: { mode: "portions", valeur: 10 } },
    creeLe: 1,
    statut: "en_attente",
    ...extra,
  };
}

function controle(idLocal: string, productionRef: { sorte: "reel"; id: number } | { sorte: "local"; idLocal: string }): ElementFile {
  return {
    idLocal,
    action: { type: "controleHaccp", idLocal, productionRef, recetteEtapeId: 3, valeur: "71 °C", conforme: true },
    creeLe: 2,
    statut: "en_attente",
  };
}

test("une saisie refusée par le serveur est présentée comme refusée, avec le motif reçu", () => {
  const refusee = production("p1", { statut: "erreur", derniereErreur: "Recette introuvable" });
  assert.deepEqual(etatSaisie(refusee, [refusee]), { etat: "refusee", motif: "Recette introuvable" });
  const attente = production("p2");
  assert.deepEqual(etatSaisie(attente, [attente]), { etat: "en_attente" });
});

test("un contrôle rattaché à une production encore en file attend celle-ci (même si elle est refusée)", () => {
  const prod = production("p1", { statut: "erreur", derniereErreur: "Recette introuvable" });
  const ctrl = controle("c1", { sorte: "local", idLocal: "p1" });
  assert.deepEqual(etatSaisie(ctrl, [prod, ctrl]), { etat: "attend_production", productionRefusee: true });
  const prodEnAttente = production("p2");
  const ctrl2 = controle("c2", { sorte: "local", idLocal: "p2" });
  assert.deepEqual(etatSaisie(ctrl2, [prodEnAttente, ctrl2]), { etat: "attend_production", productionRefusee: false });
  // Contrôle sur une production déjà enregistrée : simplement en attente d'envoi.
  const ctrl3 = controle("c3", { sorte: "reel", id: 40 });
  assert.deepEqual(etatSaisie(ctrl3, [ctrl3]), { etat: "en_attente" });
});

test("abandonner une production abandonne aussi ses contrôles en file ; un contrôle s'abandonne seul", () => {
  const elements = [
    production("p1"),
    controle("c1", { sorte: "local", idLocal: "p1" }),
    controle("c2", { sorte: "local", idLocal: "p1" }),
    production("p2"),
    controle("c3", { sorte: "local", idLocal: "p2" }),
    controle("c4", { sorte: "reel", id: 40 }),
  ];
  assert.deepEqual(saisiesAAbandonner(elements, "p1").sort(), ["c1", "c2", "p1"]);
  assert.deepEqual(saisiesAAbandonner(elements, "c3"), ["c3"]);
  assert.deepEqual(saisiesAAbandonner(elements, "inconnu"), []);
});

test("libellé : celui mémorisé à la saisie, sinon une description générique (saisies plus anciennes)", () => {
  const avecLibelle = production("p1");
  if (avecLibelle.action.type === "production") avecLibelle.action.libelle = "Riz cuit — 10 portions";
  assert.equal(libelleSaisie(avecLibelle), "Riz cuit — 10 portions");
  assert.equal(libelleSaisie(production("p2")), "Production (recette n° 12)");
  assert.equal(libelleSaisie(controle("c1", { sorte: "reel", id: 40 })), "Contrôle HACCP : 71 °C");
});
