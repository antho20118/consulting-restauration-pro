import { useEffect, useState } from "react";
import AppRoutes from "./routes/AppRoutes";
import LoginPage from "./features/auth/pages/LoginPage";
import { getToken } from "./config/api";

export default function App() {
  const [connecte, setConnecte] = useState(() => getToken() !== null);

  useEffect(() => {
    function surDeconnexion() {
      setConnecte(false);
    }
    window.addEventListener("auth:logout", surDeconnexion);
    return () => window.removeEventListener("auth:logout", surDeconnexion);
  }, []);

  if (!connecte) {
    return <LoginPage onConnexion={() => setConnecte(true)} />;
  }

  return <AppRoutes />;
}
