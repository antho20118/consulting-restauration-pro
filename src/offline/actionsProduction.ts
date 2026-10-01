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

export type ResultatEnregistrementProduction =
  | { sorte: "synchronise"; production: ProductionDetail }
  | { sorte: "en_attente"; idLocal: string };

async function mettreEnFileProduction(recetteId: number, cible: CibleProduction, depotId?: number): Promise<string> {
  const idLocal = crypto.randomUUID();
  await ajouterElement({ type: "production", idLocal, recetteId, cible, depotId });
  return idLocal;
}

export async function enregistrerProductionResiliente(
  recetteId: number,
  cible: CibleProduction,
  depotId?: number
): Promise<ResultatEnregistrementProduction> {
  if (!navigator.onLine) {
    return { sorte: "en_attente", idLocal: await mettreEnFileProduction(recetteId, cible, depotId) };
  }
  try {
    const production = await enregistrerProduction(recetteId, cible, depotId);
    return { sorte: "synchronise", production };
  } catch (erreur) {
    if (estPanneReseau(erreur)) {
      return { sorte: "en_attente", idLocal: await mettreEnFileProduction(recetteId, cible, depotId) };
    }
    throw erreur;
  }
}

export type ControleSaisi = { recetteEtapeId: number; valeur: string; conforme: boolean; commentaire?: string };

export type ResultatAjoutControle =
  | { sorte: "synchronise"; production: ProductionDetail }
  | { sorte: "en_attente"; idLocal: string };

async function mettreEnFileControle(productionId: number, controle: ControleSaisi): Promise<string> {
  const idLocal = crypto.randomUUID();
  await ajouterElement({
    type: "controleHaccp",
    idLocal,
    productionRef: { sorte: "reel", id: productionId },
    recetteEtapeId: controle.recetteEtapeId,
    valeur: controle.valeur,
    conforme: controle.conforme,
    commentaire: controle.commentaire,
  });
  return idLocal;
}

export async function ajouterControleResilient(
  productionId: number,
  controle: ControleSaisi
): Promise<ResultatAjoutControle> {
  if (!navigator.onLine) {
    return { sorte: "en_attente", idLocal: await mettreEnFileControle(productionId, controle) };
  }
  try {
    const production = await ajouterControle(productionId, controle);
    return { sorte: "synchronise", production };
  } catch (erreur) {
    if (estPanneReseau(erreur)) {
      return { sorte: "en_attente", idLocal: await mettreEnFileControle(productionId, controle) };
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
  const idLocal = crypto.randomUUID();
  await ajouterElement({
    type: "controleHaccp",
    idLocal,
    productionRef: { sorte: "local", idLocal: idLocalProduction },
    recetteEtapeId: controle.recetteEtapeId,
    valeur: controle.valeur,
    conforme: controle.conforme,
    commentaire: controle.commentaire,
  });
  return { idLocal };
}
