import { useEffect, useState } from "react";

// navigator.onLine reflète la connexion réseau de l'appareil (wifi/4G), pas la joignabilité réelle
// du serveur — un faux positif reste possible (wifi connecté mais routeur sans accès internet),
// mais c'est le même signal que celui déjà utilisé pour déclencher la synchronisation de la file
// d'attente (voir src/offline/fileAttente.ts), donc cohérent avec ce que l'indicateur promet.
export function useEnLigne(): boolean {
  const [enLigne, setEnLigne] = useState(navigator.onLine);

  useEffect(() => {
    function surLigne() {
      setEnLigne(true);
    }
    function surHorsLigne() {
      setEnLigne(false);
    }
    window.addEventListener("online", surLigne);
    window.addEventListener("offline", surHorsLigne);
    return () => {
      window.removeEventListener("online", surLigne);
      window.removeEventListener("offline", surHorsLigne);
    };
  }, []);

  return enLigne;
}
