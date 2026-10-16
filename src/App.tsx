import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import AppRoutes from "./routes/AppRoutes";
import LoginPage from "./features/auth/pages/LoginPage";
import { getToken } from "./config/api";
import { demarrerPrechargementLectures } from "./offline/demarrerPrechargement";

export default function App() {
  const [connecte, setConnecte] = useState(() => getToken() !== null);

  useEffect(() => {
    function surDeconnexion() {
      setConnecte(false);
    }
    window.addEventListener("auth:logout", surDeconnexion);
    return () => window.removeEventListener("auth:logout", surDeconnexion);
  }, []);

  // Une fois connecté (ou à l'ouverture si déjà connecté) : toutes les fiches recettes, menus et
  // productions sont préchargées pour rester lisibles sans réseau (voir demarrerPrechargement.ts).
  useEffect(() => {
    if (connecte) demarrerPrechargementLectures().catch(() => {});
  }, [connecte]);

  return (
    <>
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      {connecte ? <AppRoutes /> : <LoginPage onConnexion={() => setConnecte(true)} />}
    </>
  );
}
