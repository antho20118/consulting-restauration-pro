import { Link, useLocation } from "react-router-dom";
import { RefreshCw, LogOut } from "lucide-react";
import { seDeconnecter } from "../config/api";

const menu = [
  { label: "🏠 Tableau de bord", path: "/" },
  { label: "📖 Fiches recettes", path: "/recettes" },
  { label: "🍽️ Menus", path: "/menus" },
  { label: "🥕 Base ingrédients", path: "/ingredients" },
  { label: "🚚 Fournisseurs", path: "/fournisseurs" },
  { label: "🏭 Production", path: "/production" },
  { label: "🛡️ HACCP", path: "/haccp" },
  { label: "📦 Mouvements de stock", path: "/mouvements" },
  { label: "🏭 Dépôts", path: "/depots" },
  { label: "⚙ Paramètres", path: "/parametres" },
];

type Props = {
  ouverte: boolean;
  onFermer: () => void;
};

export default function Sidebar({ ouverte, onFermer }: Props) {
  const location = useLocation();

  return (
    <aside
      className={`app-sidebar${ouverte ? " ouverte" : ""}`}
      style={{
        width: 260,
        background: "#202729",
        padding: 20,
        minHeight: "100vh",
        color: "white",
      }}
    >
      <h2>🍽 Consulting</h2>

      {menu.map((item) => (
        <Link
          key={item.path}
          to={item.path}
          // Sans-effet sur desktop (le tiroir hors écran n'existe qu'en dessous de 768px, voir
          // index.css) : ferme simplement le tiroir mobile après avoir choisi une page, plutôt que
          // de le laisser ouvert par-dessus la page suivante.
          onClick={onFermer}
          style={{
            display: "block",
            padding: 12,
            marginBottom: 10,
            textDecoration: "none",
            color: "white",
            borderRadius: 8,
            background:
              location.pathname === item.path ? "#16a085" : "#3b4447",
          }}
        >
          {item.label}
        </Link>
      ))}

      <button
        onClick={() => {
          // Force une requête neuve (contourne un cache navigateur ou une app ajoutée à
          // l'écran d'accueil qui, elle, n'a pas de bouton "recharger" accessible).
          window.location.href = window.location.pathname + "?_=" + Date.now();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: 12,
          marginTop: 20,
          border: "none",
          borderRadius: 8,
          background: "#3b4447",
          color: "white",
          cursor: "pointer",
        }}
      >
        <RefreshCw size={16} /> Actualiser
      </button>

      <button
        onClick={seDeconnecter}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: 12,
          marginTop: 10,
          border: "none",
          borderRadius: 8,
          background: "#3b4447",
          color: "white",
          cursor: "pointer",
        }}
      >
        <LogOut size={16} /> Déconnexion
      </button>
    </aside>
  );
}