import { traiterFile, type ActionControleHACCP, type ActionProduction } from "./fileAttenteCore";
import { ajouterElement, appliquerResultatTraitement, busFileAttente, listerElements } from "./fileAttenteDb";
import { ajouterControle, enregistrerProduction } from "../features/productions/services/productionService";

// Émis avec {idLocal, id} à chaque production nouvellement synchronisée — écouté par
// ProductionPlanifierPage pour afficher le lien réel vers /productions/:id une fois disponible
// (avant la synchronisation, ce lien n'existe pas : voir enregistrerProductionResiliente).
export const EVENEMENT_PRODUCTION_SYNCHRONISEE = "production-synchronisee";

async function executerProduction(action: ActionProduction): Promise<number> {
  const production = await enregistrerProduction(action.recetteId, action.cible, action.depotId);
  return production.id;
}

async function executerControleHaccp(action: ActionControleHACCP, productionId: number): Promise<void> {
  await ajouterControle(productionId, {
    recetteEtapeId: action.recetteEtapeId,
    valeur: action.valeur,
    conforme: action.conforme,
    commentaire: action.commentaire,
  });
}

let synchronisationEnCours: Promise<void> | null = null;

// Idempotent et sans effet si rien n'est en file — peut être appelée librement (au retour du
// réseau, au chargement de l'app, ou manuellement) sans risquer de double-traitement : un appel
// pendant qu'une synchronisation est déjà en cours attend simplement celle-ci plutôt que d'en
// démarrer une seconde en parallèle sur la même file.
export async function synchroniser(): Promise<void> {
  if (synchronisationEnCours) return synchronisationEnCours;

  synchronisationEnCours = (async () => {
    const elements = await listerElements();
    if (elements.length === 0) return;

    const resultat = await traiterFile(elements, {
      production: executerProduction,
      controleHaccp: executerControleHaccp,
    });

    await appliquerResultatTraitement(resultat);

    for (const [idLocal, id] of Object.entries(resultat.idsReels)) {
      busFileAttente.dispatchEvent(new CustomEvent(EVENEMENT_PRODUCTION_SYNCHRONISEE, { detail: { idLocal, id } }));
    }
  })();

  try {
    await synchronisationEnCours;
  } finally {
    synchronisationEnCours = null;
  }
}

let ecouteursInstalles = false;

// À appeler une fois au démarrage de l'app (voir enregistrerPwa.ts) : synchronise immédiatement
// (au cas où des actions attendaient déjà, réseau revenu pendant que l'app était fermée), puis à
// chaque retour de connexion.
export function demarrerSynchronisationAutomatique(): void {
  if (ecouteursInstalles) return;
  ecouteursInstalles = true;

  window.addEventListener("online", () => {
    synchroniser().catch(() => {
      // Best-effort : une synchronisation échouée reste en file, retentée au prochain passage
      // (prochain "online", prochain appel manuel) — jamais une erreur bloquante pour l'usage de
      // l'app.
    });
  });

  if (navigator.onLine) {
    synchroniser().catch(() => {});
  }
}

export { ajouterElement };
