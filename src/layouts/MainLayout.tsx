import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";

export default function MainLayout() {
  const [sidebarOuverte, setSidebarOuverte] = useState(false);

  return (
    <div
      className="app-layout"
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#f4f6f8",
      }}
    >
      <Sidebar ouverte={sidebarOuverte} onFermer={() => setSidebarOuverte(false)} />

      {/* Visible uniquement sous 768px (voir .app-sidebar-fond dans index.css) : referme le
          tiroir au clic en dehors, comme n'importe quel tiroir/menu mobile. */}
      <div
        className={`app-sidebar-fond${sidebarOuverte ? " visible" : ""}`}
        onClick={() => setSidebarOuverte(false)}
      />

      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: 24,
        }}
      >
        <button
          className="app-hamburger"
          onClick={() => setSidebarOuverte(true)}
          aria-label="Ouvrir le menu"
          style={{
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            padding: "8px 12px",
            border: "none",
            borderRadius: 8,
            background: "#202729",
            color: "white",
            cursor: "pointer",
          }}
        >
          <Menu size={18} /> Menu
        </button>

        <Outlet />
      </main>
    </div>
  );
}