import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { construireGrapheRestauration } from "../../prisma/utils/ordreRestauration.js";

// F08 de l'audit forensique : vérifie le calcul de l'ordre d'insertion contre le schéma Prisma
// réel (via Prisma.dmmf) — pas de base de données nécessaire, logique pure.

test("calcule un ordre topologique couvrant tous les modèles du schéma courant, sans cycle non résolu", () => {
  const graphe = construireGrapheRestauration();
  const nomsModeles = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();

  assert.deepEqual(graphe.ordre.slice().sort(), nomsModeles, "chaque modèle du schéma doit apparaître exactement une fois dans l'ordre");
  assert.equal(graphe.cyclesNonResolus.length, 0, "aucun cycle entre modèles distincts n'est attendu dans le schéma actuel");
});

test("détecte l'auto-relation SousCategorieRecette.parentId et la classe à part de l'ordre linéaire", () => {
  const graphe = construireGrapheRestauration();
  assert.equal(graphe.autoRelations.length, 1, "une seule auto-relation est attendue dans le schéma actuel");
  const [auto] = graphe.autoRelations;
  assert.equal(auto.modele, "SousCategorieRecette");
  assert.equal(auto.champFK, "parentId");
  assert.equal(auto.modeleCible, "SousCategorieRecette");
  assert.equal(auto.optionnelle, true, "l'auto-relation doit être nullable, sinon aucune insertion n'est jamais possible");
});

test("l'ordre respecte réellement toutes les dépendances FK du schéma (jamais un modèle avant ce dont il dépend)", () => {
  const graphe = construireGrapheRestauration();
  const position = new Map(graphe.ordre.map((nom, i) => [nom, i]));

  for (const modele of Prisma.dmmf.datamodel.models) {
    for (const champ of modele.fields) {
      if (champ.kind !== "object" || !champ.relationFromFields || champ.relationFromFields.length === 0) continue;
      if (champ.type === modele.name) continue; // auto-relation, hors tri linéaire — voir le test dédié
      assert.ok(
        position.get(modele.name)! > position.get(champ.type)!,
        `${modele.name} (position ${position.get(modele.name)}) référence ${champ.type} (position ${position.get(champ.type)}) ` +
          "mais apparaît avant lui dans l'ordre d'insertion calculé"
      );
    }
  }
});

test("le calcul est déterministe (deux appels successifs produisent le même ordre)", () => {
  const g1 = construireGrapheRestauration();
  const g2 = construireGrapheRestauration();
  assert.deepEqual(g1.ordre, g2.ordre);
});
