import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import AppRoutes from "./routes/AppRoutes";
import LoginPage from "./features/auth/pages/LoginPage";
import { EVENEMENT_COMPTE_MODIFIE, getToken } from "./config/api";
import { demarrerRenouvellementSession } from "./features/auth/services/session";
import { demarrerPrechargementLectures } from "./offline/demarrerPrechargement";

export default function App() {
  const [connecte, setConnecte] = useState(() => getToken() !== null);
  // Incrémenté quand le rôle du compte change (voir session.ts) : tous les écrans sont remontés,
  // donc réaffichés selon le nouveau rôle (menus, colonnes de prix, écrans fermés au cuisinier).
  const [versionCompte, setVersionCompte] = useState(0);

  useEffect(() => {
    function surDeconnexion() {
      setConnecte(false);
    }
    function surCompteModifie() {
      setVersionCompte((v) => v + 1);
    }
    window.addEventListener("auth:logout", surDeconnexion);
    window.addEventListener(EVENEMENT_COMPTE_MODIFIE, surCompteModifie);
    return () => {
      window.removeEventListener("auth:logout", surDeconnexion);
      window.removeEventListener(EVENEMENT_COMPTE_MODIFIE, surCompteModifie);
    };
  }, []);

  // Une fois connecté (ou à l'ouverture si déjà connecté) : toutes les fiches recettes, menus et
  // productions sont préchargées pour rester lisibles sans réseau (voir demarrerPrechargement.ts),
  // et la session est renouvelée tant que l'application sert (voir session.ts).
  useEffect(() => {
    if (!connecte) return;
    demarrerPrechargementLectures().catch(() => {});
    return demarrerRenouvellementSession();
  }, [connecte]);

  return (
    <>
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      {connecte ? <AppRoutes key={versionCompte} /> : <LoginPage onConnexion={() => setConnecte(true)} />}
    </>
  );
}
