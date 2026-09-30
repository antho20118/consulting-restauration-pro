import { useEffect, useState } from "react";
import { busFileAttente, listerElements } from "./fileAttenteDb";

// Nombre d'actions actuellement en attente de synchronisation — rafraîchi à chaque changement de
// la file (voir busFileAttente dans fileAttenteDb.ts), jamais par sondage périodique.
export function useFileAttente(): { enAttente: number } {
  const [enAttente, setEnAttente] = useState(0);

  useEffect(() => {
    let annule = false;

    function rafraichir() {
      listerElements().then((elements) => {
        if (!annule) setEnAttente(elements.length);
      });
    }

    rafraichir();
    busFileAttente.addEventListener("changement", rafraichir);
    return () => {
      annule = true;
      busFileAttente.removeEventListener("changement", rafraichir);
    };
  }, []);

  return { enAttente };
}
