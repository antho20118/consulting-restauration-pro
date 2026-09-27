import { test } from "node:test";
import assert from "node:assert/strict";
import { regrouperFournisseursParNom } from "../../src/features/fournisseurs/utils/regrouperFournisseurs.js";
import type { Fournisseur } from "../../src/features/fournisseurs/types/fournisseur.js";

// Teste src/features/fournisseurs/utils/regrouperFournisseurs.ts — chantier « refonte liste
// fournisseurs » : ce module ne fait qu'organiser la présentation (aucune écriture en base, aucune
// fusion). Règle validée : trim() + comparaison insensible à la casse, aucune autre normalisation.

let prochainId = 1;

function fournisseur(partiel: Partial<Fournisseur> & { nom: string }): Fournisseur {
  return {
    id: prochainId++,
    telephone: null,
    email: null,
    siteWeb: null,
    ...partiel,
  };
}

test("A. un seul fournisseur : un seul groupe, aucune fusion à faire", () => {
  const f = fournisseur({ nom: "METRO", _count: { tarifs: 3 } });
  const groupes = regrouperFournisseursParNom([f]);

  assert.equal(groupes.length, 1);
  assert.equal(groupes[0].nom, "METRO");
  assert.deepEqual(groupes[0].fournisseurs, [f]);
  assert.equal(groupes[0].totalTarifs, 3);
});

test("B. deux fournisseurs de même nom exact : un seul groupe, les deux enregistrements physiques conservés", () => {
  const a = fournisseur({ nom: "METRO", telephone: "0100000001", _count: { tarifs: 2 } });
  const b = fournisseur({ nom: "METRO", telephone: "0100000002", _count: { tarifs: 5 } });
  const groupes = regrouperFournisseursParNom([a, b]);

  assert.equal(groupes.length, 1);
  assert.equal(groupes[0].fournisseurs.length, 2);
  assert.deepEqual(groupes[0].fournisseurs, [a, b], "les deux enregistrements physiques distincts doivent rester présents, dans l'ordre reçu");
  assert.equal(groupes[0].totalTarifs, 7, "le total agrégé additionne les tarifs des deux enregistrements sans en perdre");
});

test("C. deux fournisseurs homonymes avec des tarifs différents : chaque tarif reste rattaché à son fournisseur physique propre", () => {
  const a = fournisseur({ nom: "METRO", _count: { tarifs: 4 } });
  const b = fournisseur({ nom: "METRO", _count: { tarifs: 9 } });
  const groupes = regrouperFournisseursParNom([a, b]);

  assert.equal(groupes.length, 1);
  const [groupe] = groupes;
  const trouveA = groupe.fournisseurs.find((f) => f.id === a.id);
  const trouveB = groupe.fournisseurs.find((f) => f.id === b.id);
  assert.ok(trouveA, "le fournisseur A doit rester accessible individuellement");
  assert.ok(trouveB, "le fournisseur B doit rester accessible individuellement");
  assert.equal(trouveA?._count?.tarifs, 4, "les tarifs de A ne doivent jamais être écrasés par ceux de B");
  assert.equal(trouveB?._count?.tarifs, 9, "les tarifs de B ne doivent jamais être écrasés par ceux de A");
  assert.equal(groupe.totalTarifs, 13);
});

test("D. deux fournisseurs de noms différents : deux groupes distincts", () => {
  const a = fournisseur({ nom: "METRO", _count: { tarifs: 1 } });
  const b = fournisseur({ nom: "PROMOCASH", _count: { tarifs: 1 } });
  const groupes = regrouperFournisseursParNom([a, b]);

  assert.equal(groupes.length, 2);
  assert.deepEqual(groupes.map((g) => g.nom).sort(), ["METRO", "PROMOCASH"]);
});

test("règle exacte de regroupement : trim + casse-insensible, rien d'autre", () => {
  const a = fournisseur({ nom: "  Metro  " });
  const b = fournisseur({ nom: "METRO" });
  const c = fournisseur({ nom: "métro" }); // accent différent : jamais considéré identique
  const d = fournisseur({ nom: "Metro Cash" }); // espace interne différent : jamais considéré identique

  const groupes = regrouperFournisseursParNom([a, b, c, d]);

  assert.equal(groupes.length, 3, "« Metro » (avec espaces) et « METRO » doivent fusionner ; « métro » et « Metro Cash » restent séparés");
  const groupeMetro = groupes.find((g) => g.fournisseurs.some((f) => f.id === a.id));
  assert.equal(groupeMetro?.fournisseurs.length, 2, "seuls a et b (trim+casse) doivent être regroupés ensemble");
  assert.ok(groupeMetro?.fournisseurs.some((f) => f.id === b.id));
});

test("le nom affiché du groupe n'est jamais modifié : c'est le nom original du premier enregistrement rencontré", () => {
  const a = fournisseur({ nom: "  Metro  " });
  const b = fournisseur({ nom: "METRO" });
  const groupes = regrouperFournisseursParNom([a, b]);

  assert.equal(groupes[0].nom, "  Metro  ", "le nom affiché doit rester la valeur brute d'origine, non trimée/reformatée");
});
