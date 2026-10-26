import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import AppRoutes from "./routes/AppRoutes";
import LoginPage from "./features/auth/pages/LoginPage";
import { EVENEMENT_COMPTE_MODIFIE, getToken } from "./config/api";
import { demarrerRenouvellementSession } from "./features/auth/services/session";
import { demarrerPrechargementLectures } from "./offline/demarrerPrechargement";

// Sur téléphone (même seuil que le tiroir du menu, voir index.css), les notifications s'affichent
// en bas : en haut, elles recouvraient le menu — et le compteur des saisies en attente, que l'on
// ouvre justement juste après une saisie hors ligne, recevait le toucher à sa place.
const REQUETE_TELEPHONE = "(max-width: 768px)";

function useEstTelephone(): boolean {
  const [estTelephone, setEstTelephone] = useState(() => window.matchMedia(REQUETE_TELEPHONE).matches);
  useEffect(() => {
    const requete = window.matchMedia(REQUETE_TELEPHONE);
    const surChangement = () => setEstTelephone(requete.matches);
    requete.addEventListener("change", surChangement);
    return () => requete.removeEventListener("change", surChangement);
  }, []);
  return estTelephone;
}

export default function App() {
  const estTelephone = useEstTelephone();
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
      {/* pointerEvents "none" : une notification ne capte jamais le toucher ni le clic — le doigt
          atteint le bouton qu'elle recouvre pendant ses quelques secondes d'affichage. */}
      <Toaster
        position={estTelephone ? "bottom-center" : "top-right"}
        toastOptions={{ duration: 4000, style: { pointerEvents: "none" } }}
      />
      {connecte ? <AppRoutes key={versionCompte} /> : <LoginPage onConnexion={() => setConnecte(true)} />}
    </>
  );
}
