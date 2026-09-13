import { Link, useLocation } from "react-router-dom";

const menu = [
  { label: "🏠 Tableau de bord", path: "/" },
  { label: "📖 Fiches techniques", path: "/recettes" },
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
    </aside>
  );
}