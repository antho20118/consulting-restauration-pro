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
//
// libelle : description lisible mémorisée à la saisie (recette, quantité, valeur constatée), pour
// l'écran des saisies en attente (src/features/saisies/) — absente des saisies plus anciennes, voir
// libelleSaisie.
export type ActionProduction = {
  type: "production";
  idLocal: string;
  saisiLe?: string;
  libelle?: string;
  recetteId: number;
  cible: CibleProductionOffline;
  depotId?: number;
};

export type ReferenceProduction = { sorte: "reel"; id: number } | { sorte: "local"; idLocal: string };

export type ActionControleHACCP = {
  type: "controleHaccp";
  idLocal: string;
  saisiLe?: string;
  libelle?: string;
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

// État d'une saisie pour l'écran des saisies en attente : jusqu'ici, une saisie refusée par le
// serveur (recette supprimée entre-temps, saisie trop ancienne…) restait en file, renvoyée à chaque
// synchronisation, sans que personne n'en voie le motif — seul un compteur restait affiché.
export type EtatSaisie =
  | { etat: "en_attente" }
  | { etat: "refusee"; motif: string }
  // Contrôle rattaché à une production elle-même encore en file : envoyé seulement après elle.
  | { etat: "attend_production"; productionRefusee: boolean };

export function etatSaisie(element: ElementFile, elements: ElementFile[]): EtatSaisie {
  const { action } = element;
  if (action.type === "controleHaccp" && action.productionRef.sorte === "local") {
    const { idLocal } = action.productionRef;
    const production = elements.find((e) => e.action.type === "production" && e.action.idLocal === idLocal);
    if (production) return { etat: "attend_production", productionRefusee: production.statut === "erreur" };
  }
  if (element.statut === "erreur") return { etat: "refusee", motif: element.derniereErreur ?? "Refusée par le serveur" };
  return { etat: "en_attente" };
}

// idLocal des éléments à retirer de la file quand l'utilisateur abandonne une saisie : une
// production emporte les contrôles qui l'attendent (sans elle, ils ne pourraient jamais partir).
export function saisiesAAbandonner(elements: ElementFile[], idLocal: string): string[] {
  const element = elements.find((e) => e.idLocal === idLocal);
  if (!element) return [];
  if (element.action.type !== "production") return [idLocal];
  const idProduction = element.action.idLocal;
  const controles = elements.filter(
    (e) => e.action.type === "controleHaccp" && e.action.productionRef.sorte === "local" && e.action.productionRef.idLocal === idProduction
  );
  return [idLocal, ...controles.map((e) => e.idLocal)];
}

export function libelleSaisie(element: ElementFile): string {
  const { action } = element;
  if (action.libelle) return action.libelle;
  return action.type === "production" ? `Production (recette n° ${action.recetteId})` : `Contrôle HACCP : ${action.valeur}`;
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
