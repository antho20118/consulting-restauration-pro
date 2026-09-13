import { Link, useLocation } from "react-router-dom";
import { RefreshCw } from "lucide-react";

const menu = [
  { label: "🏠 Tableau de bord", path: "/" },
  { label: "📖 Fiches techniques", path: "/recettes" },
  { label: "🍽️ Menus", path: "/menus" },
  { label: "🥕 Base ingrédients", path: "/ingredients" },
  { label: "🚚 Fournisseurs", path: "/fournisseurs" },
  { label: "📦 Mouvements de stock", path: "/mouvements" },
  { label: "🏭 Dépôts", path: "/depots" },
  { label: "⚙ Paramètres", path: "/parametres" },
];

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside
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
    </aside>
  );
}