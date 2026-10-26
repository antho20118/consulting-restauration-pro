import { useEffect, useState } from "react";
import { busFileAttente, listerElements } from "./fileAttenteDb";
import type { ElementFile } from "./fileAttenteCore";

// Contenu actuel de la file des saisies hors connexion — rafraîchi à chaque changement de la file
// (voir busFileAttente dans fileAttenteDb.ts), jamais par sondage périodique. refusees : saisies
// refusées par le serveur au dernier envoi, à vérifier sur l'écran des saisies en attente.
export function useFileAttente(): { enAttente: number; refusees: number; elements: ElementFile[] } {
  const [elements, setElements] = useState<ElementFile[]>([]);

  useEffect(() => {
    let annule = false;

    function rafraichir() {
      listerElements().then((liste) => {
        if (!annule) setElements(liste);
      });
    }

    rafraichir();
    busFileAttente.addEventListener("changement", rafraichir);
    return () => {
      annule = true;
      busFileAttente.removeEventListener("changement", rafraichir);
    };
  }, []);

  return { enAttente: elements.length, refusees: elements.filter((e) => e.statut === "erreur").length, elements };
}
