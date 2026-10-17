import type { CibleProduction } from "../features/production/types/production";
import type { ProductionDetail } from "../features/productions/types/production";
import { ajouterControle, enregistrerProduction } from "../features/productions/services/productionService";
import { ajouterElement } from "./fileAttenteDb";

// Enveloppe resiliente des deux seules actions d'écriture couvertes par le hors-ligne (voir la
// discussion produit : consulter + créer une production + enregistrer un contrôle HACCP). Ne
// change jamais le comportement en ligne : une erreur applicative réelle (validation, 401, 500)
// continue de se propager telle quelle à l'appelant, qui doit la traiter exactement comme avant.
// Seule une panne réseau véritable (navigator.onLine faux, ou l'échec fetch au niveau navigateur —
// TypeError, jamais une réponse HTTP d'erreur qui a, elle, bien atteint le serveur) bascule vers la
// file d'attente plutôt que de faire remonter l'erreur.
function estPanneReseau(erreur: unknown): boolean {
  return erreur instanceof TypeError;
}

// Clé unique et moment de la saisie, fixés AVANT la première tentative et réutilisés tels quels si
// elle échoue faute de réseau : une requête partie mais dont la réponse s'est perdue est ainsi
// reconnue par le serveur au renvoi (jamais une seconde production ni un second contrôle), et la
// saisie mise en file garde l'heure où elle a réellement été faite (point 9 de l'audit du 15/10).
// En ligne, seule la clé est transmise : l'heure retenue reste celle du serveur, plus fiable que
// l'horloge du téléphone.
function nouvelleSaisie() {
  return { idLocal: crypto.randomUUID(), saisiLe: new Date().toISOString() };
}

export type ResultatEnregistrementProduction =
  | { sorte: "synchronise"; production: ProductionDetail }
  | { sorte: "en_attente"; idLocal: string };

async function mettreEnFileProduction(
  saisie: { idLocal: string; saisiLe: string },
  recetteId: number,
  cible: CibleProduction,
  depotId?: number
): Promise<string> {
  await ajouterElement({ type: "production", ...saisie, recetteId, cible, depotId });
  return saisie.idLocal;
}

export async function enregistrerProductionResiliente(
  recetteId: number,
  cible: CibleProduction,
  depotId?: number
): Promise<ResultatEnregistrementProduction> {
  const saisie = nouvelleSaisie();
  if (!navigator.onLine) {
    return { sorte: "en_attente", idLocal: await mettreEnFileProduction(saisie, recetteId, cible, depotId) };
  }
  try {
    const production = await enregistrerProduction(recetteId, cible, depotId, { cleIdempotence: saisie.idLocal });
    return { sorte: "synchronise", production };
  } catch (erreur) {
    if (estPanneReseau(erreur)) {
      return { sorte: "en_attente", idLocal: await mettreEnFileProduction(saisie, recetteId, cible, depotId) };
    }
    throw erreur;
  }
}

export type ControleSaisi = { recetteEtapeId: number; valeur: string; conforme: boolean; commentaire?: string };

export type ResultatAjoutControle =
  | { sorte: "synchronise"; production: ProductionDetail }
  | { sorte: "en_attente"; idLocal: string };

async function mettreEnFileControle(
  saisie: { idLocal: string; saisiLe: string },
  productionId: number,
  controle: ControleSaisi
): Promise<string> {
  await ajouterElement({
    type: "controleHaccp",
    ...saisie,
    productionRef: { sorte: "reel", id: productionId },
    recetteEtapeId: controle.recetteEtapeId,
    valeur: controle.valeur,
    conforme: controle.conforme,
    commentaire: controle.commentaire,
  });
  return saisie.idLocal;
}

export async function ajouterControleResilient(
  productionId: number,
  controle: ControleSaisi
): Promise<ResultatAjoutControle> {
  const saisie = nouvelleSaisie();
  if (!navigator.onLine) {
    return { sorte: "en_attente", idLocal: await mettreEnFileControle(saisie, productionId, controle) };
  }
  try {
    const production = await ajouterControle(productionId, { ...controle, cleIdempotence: saisie.idLocal });
    return { sorte: "synchronise", production };
  } catch (erreur) {
    if (estPanneReseau(erreur)) {
      return { sorte: "en_attente", idLocal: await mettreEnFileControle(saisie, productionId, controle) };
    }
    throw erreur;
  }
}

// Un contrôle rattaché à une production ELLE-MÊME pas encore synchronisée (voir
// ResultatEnregistrementProduction, sorte "en_attente") : aucun id réel n'existe côté serveur,
// donc aucun appel réseau possible même en ligne — toujours mis en file, résolu automatiquement
// dès que la production dont il dépend aura elle-même été synchronisée (voir fileAttenteCore.ts,
// ReferenceProduction "local").
export async function ajouterControleSurProductionLocale(
  idLocalProduction: string,
  controle: ControleSaisi
): Promise<{ idLocal: string }> {
  const saisie = nouvelleSaisie();
  await ajouterElement({
    type: "controleHaccp",
    ...saisie,
    productionRef: { sorte: "local", idLocal: idLocalProduction },
    recetteEtapeId: controle.recetteEtapeId,
    valeur: controle.valeur,
    conforme: controle.conforme,
    commentaire: controle.commentaire,
  });
  return { idLocal: saisie.idLocal };
}
