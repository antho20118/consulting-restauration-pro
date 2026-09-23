import { test } from "node:test";
import assert from "node:assert/strict";
import {
  peutPasserEnModeKg,
  poidsTotalInitialKg,
  portionsDepuisPoidsTotalKg,
  modeApresChangementPoidsPortion,
} from "../../src/features/recettes/utils/quantiteAProduire.js";

// Teste src/features/recettes/utils/quantiteAProduire.ts — bug rapporté le 23/09 sur le champ
// "Quantité à produire" de RecetteForm.tsx : en mode Kg, si le "Poids d'une portion" est ramené à
// 0 sans quitter ce mode, le champ Kg continuait à accepter des saisies (affichait la nouvelle
// valeur tapée) mais ne répercutait plus jamais rien sur `portions`, la donnée réellement
// enregistrée — silencieusement, sans aucune erreur ni indication visuelle.

test("poids portion positif -> le passage en mode Kg est autorisé", () => {
  assert.equal(peutPasserEnModeKg(100), true);
  assert.equal(peutPasserEnModeKg(1), true);
});

test("poids portion nul ou négatif -> le passage en mode Kg est refusé", () => {
  assert.equal(peutPasserEnModeKg(0), false);
  assert.equal(peutPasserEnModeKg(-5), false);
});

// Test principal du bug : une fois en mode Kg, si le poids de portion redevient nul, le mode doit
// automatiquement revenir à "portions" — c'est cette bascule qui manquait avant le correctif.
test("BUG : poids portion ramené à 0 en mode Kg -> retour automatique en mode Portions", () => {
  assert.equal(modeApresChangementPoidsPortion("poids", 0), "portions");
  assert.equal(modeApresChangementPoidsPortion("poids", -1), "portions");
});

test("nouvelle quantité saisie après le retour automatique en Portions : portionsDepuisPoidsTotalKg ne s'applique plus (mode changé, pas d'appel)", () => {
  // Une fois modeApresChangementPoidsPortion appliqué, l'interface repasse sur le champ "portions"
  // classique (un simple input numérique, hors de ce module) : plus aucune conversion kg->portions
  // ne doit avoir lieu tant que le mode Kg n'est pas explicitement rechoisi. On vérifie ici que
  // portionsDepuisPoidsTotalKg documente bien l'impossibilité de convertir sans poids de portion
  // (c'est justement ce qui rend l'état bugué inatteignable une fois le correctif en place).
  assert.equal(portionsDepuisPoidsTotalKg(50, 0), null);
});

test("poids portion redevenu positif -> le passage en mode Kg redevient possible", () => {
  // Aucune mémoire d'un état "a déjà été à 0" : la fonction est pure, réévaluée à chaque appel.
  assert.equal(peutPasserEnModeKg(0), false);
  assert.equal(peutPasserEnModeKg(150), true);
});

test("comportement normal inchangé : conversion kg -> portions quand le poids de portion est positif", () => {
  assert.equal(portionsDepuisPoidsTotalKg(2, 100), 20);
  assert.equal(poidsTotalInitialKg(20, 100), 2);
  // Rester en mode Kg avec un poids de portion toujours positif : le mode ne doit pas changer.
  assert.equal(modeApresChangementPoidsPortion("poids", 50), "poids");
  // Modifier le poids de portion en restant en mode Portions ne doit jamais forcer un changement
  // de mode (rien à réinitialiser, on n'était pas en mode Kg).
  assert.equal(modeApresChangementPoidsPortion("portions", 0), "portions");
  assert.equal(modeApresChangementPoidsPortion("portions", 100), "portions");
});

test("arrondi : le nombre de portions calculé est toujours un entier >= 1", () => {
  assert.equal(portionsDepuisPoidsTotalKg(0.05, 100), 1); // arrondi vers le bas mais jamais 0
  assert.equal(portionsDepuisPoidsTotalKg(1.24, 100), 12); // 12.4 -> 12
  assert.equal(portionsDepuisPoidsTotalKg(1.26, 100), 13); // 12.6 -> 13
});
