import { test } from "node:test";
import assert from "node:assert/strict";
import { prechargerLectures } from "../../src/offline/prechargementLectures.js";

// Préchargement des lectures hors connexion (voir src/offline/prechargementLectures.ts) : chaque
// fiche recette et son évaluation HACCP doivent être demandées, aux mêmes adresses que les pages,
// quelques-unes à la fois, sans qu'un échec isolé n'arrête le reste.

function chargeurFactice(recettes: { id: number }[], enEchec = new Set<string>()) {
  const demandes: string[] = [];
  // Fiches (adresses avec un id) en cours de chargement au même moment.
  let enCours = 0;
  let maxEnCours = 0;
  const charger = async (chemin: string) => {
    demandes.push(chemin);
    const fiche = /\d/.test(chemin);
    if (fiche) enCours++;
    maxEnCours = Math.max(maxEnCours, enCours);
    await new Promise((r) => setTimeout(r, 2));
    if (fiche) enCours--;
    if (enEchec.has(chemin)) throw new Error("hors ligne");
    return chemin === "/recettes" ? recettes : [];
  };
  return { charger, demandes, maxEnCours: () => maxEnCours };
}

test("listes, puis chaque fiche recette et son évaluation HACCP", async () => {
  const { charger, demandes } = chargeurFactice([{ id: 3 }, { id: 7 }]);
  const bilan = await prechargerLectures(charger);
  assert.deepEqual(
    [...demandes].sort(),
    [
      "/categories-recette",
      "/depots",
      "/haccp/evaluer/3",
      "/haccp/evaluer/7",
      "/menus",
      "/productions",
      "/recettes",
      "/recettes/3",
      "/recettes/7",
      "/sous-categories-recette",
    ].sort()
  );
  assert.deepEqual(bilan, { chargees: 10, echecs: 0 });
});

test("jamais plus de 4 fiches demandées à la fois, même pour une grande carte", async () => {
  const recettes = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
  const { charger, demandes, maxEnCours } = chargeurFactice(recettes);
  await prechargerLectures(charger);
  assert.equal(demandes.length, 6 + 100);
  assert.equal(maxEnCours(), 4);
});

test("un échec isolé n'arrête pas les autres fiches ; liste des recettes indisponible : rien de plus", async () => {
  const { charger } = chargeurFactice([{ id: 1 }, { id: 2 }], new Set(["/recettes/1"]));
  assert.deepEqual(await prechargerLectures(charger), { chargees: 9, echecs: 1 });

  const sansListe = chargeurFactice([{ id: 1 }], new Set(["/recettes"]));
  assert.deepEqual(await prechargerLectures(sansListe.charger), { chargees: 5, echecs: 1 });
  assert.deepEqual(
    [...sansListe.demandes].sort(),
    ["/categories-recette", "/depots", "/menus", "/productions", "/recettes", "/sous-categories-recette"]
  );
});

test("un préchargement par service : relancé après 12 h, ou pour un autre compte, jamais à chaque ouverture", async () => {
  const { prechargementNecessaire, INTERVALLE_PRECHARGEMENT_MS } = await import("../../src/offline/prechargementLectures.js");
  const maintenant = 1_000_000_000_000;
  assert.equal(prechargementNecessaire(null, 1, maintenant), true);
  assert.equal(prechargementNecessaire({ le: maintenant - 3600_000, utilisateurId: 1 }, 1, maintenant), false);
  assert.equal(prechargementNecessaire({ le: maintenant - INTERVALLE_PRECHARGEMENT_MS, utilisateurId: 1 }, 1, maintenant), true);
  assert.equal(prechargementNecessaire({ le: maintenant - 3600_000, utilisateurId: 2 }, 1, maintenant), true);
  // Horloge du téléphone revenue en arrière : on ne reste jamais bloqué sans préchargement.
  assert.equal(prechargementNecessaire({ le: maintenant + 3600_000, utilisateurId: 1 }, 1, maintenant), true);
});
