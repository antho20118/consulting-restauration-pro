import { openDB, type IDBPDatabase } from "idb";
import type { ActionEnAttente, ElementFile } from "./fileAttenteCore";

// Persistée (IndexedDB, via idb) plutôt qu'en mémoire : une file en mémoire perdrait tout contrôle
// HACCP saisi hors ligne si l'onglet se ferme ou si le téléphone redémarre avant le retour du
// réseau — le scénario même que ce chantier doit couvrir.
const NOM_DB = "consulting-file-attente";
const VERSION_DB = 1;
const STORE = "elements";

let promesseDb: Promise<IDBPDatabase> | null = null;

function ouvrirDb(): Promise<IDBPDatabase> {
  promesseDb ??= openDB(NOM_DB, VERSION_DB, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "idLocal" });
      }
    },
  });
  return promesseDb;
}

// Émis à chaque changement de contenu de la file (ajout, synchronisation, échec) — écouté par
// useFileAttente() pour rafraîchir le compteur affiché dans l'indicateur hors ligne, et par toute
// page qui voudrait réagir à la synchronisation d'une action qu'elle a elle-même mise en file.
export const busFileAttente = new EventTarget();

function signalerChangement() {
  busFileAttente.dispatchEvent(new Event("changement"));
}

export async function ajouterElement(action: ActionEnAttente): Promise<void> {
  const db = await ouvrirDb();
  const element: ElementFile = { idLocal: action.idLocal, action, creeLe: Date.now(), statut: "en_attente" };
  await db.put(STORE, element);
  signalerChangement();
}

export async function listerElements(): Promise<ElementFile[]> {
  const db = await ouvrirDb();
  const elements = await db.getAll(STORE);
  return elements.sort((a, b) => a.creeLe - b.creeLe);
}

export async function appliquerResultatTraitement(resultat: {
  traites: string[];
  echecs: { idLocal: string; erreur: string }[];
}): Promise<void> {
  if (resultat.traites.length === 0 && resultat.echecs.length === 0) return;

  const db = await ouvrirDb();
  const tx = db.transaction(STORE, "readwrite");
  for (const idLocal of resultat.traites) {
    await tx.store.delete(idLocal);
  }
  for (const echec of resultat.echecs) {
    const existant = await tx.store.get(echec.idLocal);
    if (existant) {
      await tx.store.put({ ...existant, statut: "erreur", derniereErreur: echec.erreur } satisfies ElementFile);
    }
  }
  await tx.done;
  signalerChangement();
}
