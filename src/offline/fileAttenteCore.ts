// Logique pure de la file d'attente hors ligne — aucune dépendance à IndexedDB, fetch ou au DOM,
// pour rester testable avec de simples fonctions en mémoire (voir
// tests/unit/fileAttenteCore.test.ts). L'adaptateur réel (src/offline/fileAttenteDb.ts) ne fait
// qu'appeler traiterFile avec de vrais exécuteurs réseau et persiste le résultat.
//
// Portée volontairement limitée à deux actions (voir la discussion produit sur le besoin réel en
// cuisine) : créer une production, et enregistrer un contrôle HACCP sur une production. Un
// contrôle peut cibler une production déjà synchronisée (id réel) OU une production elle-même
// encore en attente dans la même file (idLocal) — dans ce second cas, le contrôle n'est traité
// qu'une fois sa production résolue en id réel, jamais avant, jamais avec un id inventé.

export type CibleProductionOffline = { mode: "portions" | "poidsFiniG"; valeur: number };

// saisiLe : moment réel de la saisie (ISO), transmis au serveur avec idLocal comme clé unique de la
// saisie (point 9 de l'audit du 15/10) — la production ou le contrôle est daté de la saisie, pas de
// la synchronisation, et un renvoi (réponse perdue) n'est jamais enregistré deux fois. Optionnel :
// absent des éléments mis en file avant cette version (le serveur prend alors son heure).
export type ActionProduction = {
  type: "production";
  idLocal: string;
  saisiLe?: string;
  recetteId: number;
  cible: CibleProductionOffline;
  depotId?: number;
};

export type ReferenceProduction = { sorte: "reel"; id: number } | { sorte: "local"; idLocal: string };

export type ActionControleHACCP = {
  type: "controleHaccp";
  idLocal: string;
  saisiLe?: string;
  productionRef: ReferenceProduction;
  recetteEtapeId: number;
  valeur: string;
  conforme: boolean;
  commentaire?: string;
};

export type ActionEnAttente = ActionProduction | ActionControleHACCP;

export type ElementFile = {
  idLocal: string;
  action: ActionEnAttente;
  creeLe: number;
  statut: "en_attente" | "erreur";
  derniereErreur?: string;
};

export type ExecuteursFile = {
  production: (action: ActionProduction) => Promise<number>;
  controleHaccp: (action: ActionControleHACCP, productionId: number) => Promise<void>;
};

export type ResultatTraitement = {
  // idLocal des éléments traités avec succès (l'appelant doit les retirer de la file persistée).
  traites: string[];
  // idLocal (d'une action "production") -> id réel obtenu, pour toute production synchronisée
  // PENDANT ce passage — permet à l'appelant de mettre à jour son propre état (redirection,
  // affichage) sans devoir relire toute la file.
  idsReels: Record<string, number>;
  echecs: { idLocal: string; erreur: string }[];
};

function messageErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : "Erreur réseau";
}

// Contrôles encore en file qui visaient, par sa référence locale, une production synchronisée pendant
// ce passage : réécrits vers son id réel. Sans cela, un contrôle dont l'envoi échouait au même
// passage que sa production restait bloqué pour toujours — la production quittait la file, plus
// rien ne permettait de retrouver son id réel (point 9 de l'audit du 15/10). Renvoie uniquement les
// éléments modifiés, à persister par l'appelant.
export function rattacherProductionsSynchronisees(
  elements: ElementFile[],
  idsReels: Record<string, number>
): ElementFile[] {
  const modifies: ElementFile[] = [];
  for (const element of elements) {
    if (element.action.type !== "controleHaccp" || element.action.productionRef.sorte !== "local") continue;
    const id = idsReels[element.action.productionRef.idLocal];
    if (id === undefined) continue;
    modifies.push({ ...element, action: { ...element.action, productionRef: { sorte: "reel", id } } });
  }
  return modifies;
}

// Traite les éléments de la file DANS LEUR ORDRE DE CRÉATION (jamais réordonnés) : c'est cet ordre
// qui garantit qu'une action "production" est tentée avant tout contrôle qui la référence par
// idLocal, tant que l'appelant respecte la même convention à l'écriture (toujours ajouter en fin
// de file, jamais en tête).
export async function traiterFile(
  elements: ElementFile[],
  executeurs: ExecuteursFile
): Promise<ResultatTraitement> {
  const idsReels: Record<string, number> = {};
  const traites: string[] = [];
  const echecs: { idLocal: string; erreur: string }[] = [];

  for (const element of elements) {
    if (element.action.type === "production") {
      try {
        const id = await executeurs.production(element.action);
        idsReels[element.action.idLocal] = id;
        traites.push(element.idLocal);
      } catch (erreur) {
        echecs.push({ idLocal: element.idLocal, erreur: messageErreur(erreur) });
      }
      continue;
    }

    const { productionRef } = element.action;
    const productionId = productionRef.sorte === "reel" ? productionRef.id : idsReels[productionRef.idLocal];

    if (productionId === undefined) {
      // La production dont dépend ce contrôle n'est pas (encore) résolue en id réel dans ce
      // passage : ni erreur ni succès, on le laisse tel quel en file pour le prochain passage —
      // jamais tenté avec un id inventé, jamais perdu.
      continue;
    }

    try {
      await executeurs.controleHaccp(element.action, productionId);
      traites.push(element.idLocal);
    } catch (erreur) {
      echecs.push({ idLocal: element.idLocal, erreur: messageErreur(erreur) });
    }
  }

  return { traites, idsReels, echecs };
}
