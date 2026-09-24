import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trouverToutesCorrespondances,
  detecterDoublonsInternes,
  classifierRecetteImport,
} from "../../src/features/recettes/utils/correspondanceImportExcel.js";

// Teste correspondanceImportExcel.ts — cœur de l'import Excel sécurisé (voir
// ImporterRecettesExcelSecuriseModal.tsx) : contrairement à trouverRecetteCorrespondante
// (analyserFichierTechniques.ts), qui choisit toujours UN candidat, ces fonctions doivent pouvoir
// signaler qu'il y en a plusieurs (CAS C) ou qu'un même titre revient plusieurs fois dans le
// fichier (CAS D) — jamais de décision automatique dans ces deux cas.

test("CAS A : une seule recette correspond -> mise à jour", () => {
  const recettes = [
    { id: 1, nom: "Lasagnes bolognaises", actif: true },
    { id: 2, nom: "Sauté de veau", actif: true },
  ];
  const candidats = trouverToutesCorrespondances("LASAGNES BOLOGNAISE", recettes);
  assert.equal(candidats.length, 1);
  assert.equal(candidats[0].id, 1);
});

test("CAS B : aucune recette ne correspond -> création", () => {
  const recettes = [{ id: 1, nom: "Lasagnes bolognaises", actif: true }];
  const candidats = trouverToutesCorrespondances("TARTE AUX POMMES", recettes);
  assert.equal(candidats.length, 0);
});

test("CAS C : cas réel — SAUTE DE VEAU MARENGO correspond à plusieurs recettes existantes", () => {
  const recettes = [
    { id: 1, nom: "Saute de veau", actif: false },
    { id: 2, nom: "Sauté de veau Marengo maison", actif: true },
  ];
  const candidats = trouverToutesCorrespondances("SAUTE DE VEAU MARENGO", recettes);
  assert.equal(candidats.length, 2, "les deux recettes doivent être signalées, jamais une seule choisie");
});

test("CAS C : deux recettes strictement homonymes sont aussi une ambiguïté (aucune contrainte d'unicité en base)", () => {
  const recettes = [
    { id: 1, nom: "Ratatouille", actif: true },
    { id: 2, nom: "Ratatouille", actif: true },
  ];
  const candidats = trouverToutesCorrespondances("RATATOUILLE", recettes);
  assert.equal(candidats.length, 2);
});

test("un nom de recette vide ne doit jamais correspondre à tout par défaut", () => {
  const recettes = [{ id: 1, nom: "", actif: false }];
  const candidats = trouverToutesCorrespondances("RATATOUILLE", recettes);
  assert.equal(candidats.length, 0);
});

test("recettes inactives incluses dans la correspondance (jamais exclues, jamais réactivées ici)", () => {
  const recettes = [{ id: 1, nom: "Terrine de foie gras", actif: false }];
  const candidats = trouverToutesCorrespondances("TERRINE DE FOIE GRAS", recettes);
  assert.equal(candidats.length, 1);
  assert.equal(candidats[0].actif, false, "le statut actif n'est ni lu ni modifié par la correspondance elle-même");
});

test("normalisation : accents et casse ignorés", () => {
  const recettes = [{ id: 1, nom: "Sauté de veau", actif: true }];
  assert.equal(trouverToutesCorrespondances("SAUTE DE VEAU", recettes).length, 1);
  assert.equal(trouverToutesCorrespondances("sauté de veau", recettes).length, 1);
  assert.equal(trouverToutesCorrespondances("SAUTÉ DE VEAU", recettes).length, 1);
});

test("normalisation : mentions de poids/portion ignorées", () => {
  const recettes = [{ id: 1, nom: "Hachis parmentier", actif: true }];
  assert.equal(trouverToutesCorrespondances("HACHIS PARMENTIER (2300gr)", recettes).length, 1);
  assert.equal(trouverToutesCorrespondances("Hachis parmentier environ 1200gr", recettes).length, 1);
  assert.equal(trouverToutesCorrespondances("Hachis parmentier 1,150kg", recettes).length, 1);
});

test("CAS D : titre présent deux fois dans le fichier (cas réel RATATOUILLE, deux onglets)", () => {
  const recettesDuFichier = [
    { titre: "RATATOUILLE" },
    { titre: "TIAN DE LEGUMES" },
    { titre: "RATATOUILLE" },
  ];
  const doublons = detecterDoublonsInternes(recettesDuFichier);
  assert.equal(doublons.size, 1);
  const [indices] = doublons.values();
  assert.deepEqual([...indices].sort(), [0, 2]);
});

test("CAS D : aucun doublon interne quand tous les titres diffèrent", () => {
  const recettesDuFichier = [{ titre: "SAUCE BEURRE BLANC" }, { titre: "SAUCE BONNE FEMME" }];
  const doublons = detecterDoublonsInternes(recettesDuFichier);
  assert.equal(doublons.size, 0);
});

test("CAS D : la normalisation s'applique aussi à la détection de doublon interne (accents/casse/poids)", () => {
  const recettesDuFichier = [{ titre: "Ratatouille (770gr)" }, { titre: "RATATOUILLE" }];
  const doublons = detecterDoublonsInternes(recettesDuFichier);
  assert.equal(doublons.size, 1);
});

test("classifierRecetteImport : doublon interne prime sur la correspondance tant qu'il n'est pas résolu", () => {
  const doublons = detecterDoublonsInternes([{ titre: "RATATOUILLE" }, { titre: "RATATOUILLE" }]);
  const statut = classifierRecetteImport(0, "RATATOUILLE", doublons, [{ id: 1, nom: "Ratatouille", actif: true }]);
  assert.equal(statut.type, "doublon_interne");
});

test("classifierRecetteImport : CAS A direct quand aucun doublon interne", () => {
  const doublons = detecterDoublonsInternes([{ titre: "LASAGNES BOLOGNAISE" }]);
  const statut = classifierRecetteImport(
    0,
    "LASAGNES BOLOGNAISE",
    doublons,
    [{ id: 5, nom: "Lasagnes bolognaises", actif: true }]
  );
  assert.equal(statut.type, "mise_a_jour");
  assert.equal(statut.type === "mise_a_jour" && statut.recette.id, 5);
});

test("classifierRecetteImport : CAS B direct quand aucune correspondance", () => {
  const doublons = detecterDoublonsInternes([{ titre: "TARTE AUX POMMES" }]);
  const statut = classifierRecetteImport(0, "TARTE AUX POMMES", doublons, []);
  assert.equal(statut.type, "creation");
});

test("classifierRecetteImport : CAS C direct quand plusieurs candidats", () => {
  const doublons = detecterDoublonsInternes([{ titre: "SAUTE DE VEAU MARENGO" }]);
  const statut = classifierRecetteImport(0, "SAUTE DE VEAU MARENGO", doublons, [
    { id: 1, nom: "Saute de veau", actif: false },
    { id: 2, nom: "Sauté de veau Marengo maison", actif: true },
  ]);
  assert.equal(statut.type, "ambiguite");
  assert.equal(statut.type === "ambiguite" && statut.candidats.length, 2);
});
