import { useEffect, useMemo, useState } from "react";
import MenusTable from "../components/MenusTable";
import MenuForm from "../components/MenuForm";
import { getMenus, supprimerMenu } from "../services/menuService";
import { exporterExcel } from "../../../common/exportExcel";
import type { Menu } from "../types/menu";

export default function MenusPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [menuEnEdition, setMenuEnEdition] = useState<Menu | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");

  async function chargerMenus() {
    const data = await getMenus();
    setMenus(data);
  }

  useEffect(() => {
    getMenus().then(setMenus);
  }, []);

  const menusFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return menus;
    return menus.filter((menu) => menu.nom.toLowerCase().includes(terme));
  }, [menus, recherche]);

  function ouvrirCreation() {
    setMenuEnEdition(null);
    setFormulaireOuvert(true);
  }

  function ouvrirEdition(menu: Menu) {
    setMenuEnEdition(menu);
    setFormulaireOuvert(true);
  }

  async function supprimer(menu: Menu) {
    if (!confirm(`Supprimer le menu "${menu.nom}" ?`)) return;
    await supprimerMenu(menu.id);
    chargerMenus();
  }

  async function exporter() {
    await exporterExcel(`menus_${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        nom: "Menus",
        lignes: menusFiltres.map((menu) => ({
          Nom: menu.nom,
          Catégorie: menu.categorie?.nom ?? "",
          "Coût par personne (€)": Number(menu.coutTotal.toFixed(2)),
          "Prix de vente HT (€)": menu.prixVenteHT ?? "",
          "Food cost (%)": menu.foodCostPct != null ? Number(menu.foodCostPct.toFixed(1)) : "",
          "Marge HT (€)": menu.margeHT != null ? Number(menu.margeHT.toFixed(2)) : "",
        })),
      },
      {
        nom: "Recettes par menu",
        lignes: menusFiltres.flatMap((menu) =>
          menu.lignes.map((ligne) => ({
            Menu: menu.nom,
            Recette: ligne.recette.nom,
            Quantité: ligne.quantite,
            "Coût ligne (€)": Number(ligne.coutLigne.toFixed(2)),
          }))
        ),
      },
    ]);
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>🍽️ Menus</h1>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={ouvrirCreation}>+ Nouveau menu</button>
          <button onClick={exporter}>Exporter Excel</button>
        </div>

        <input
          type="text"
          placeholder="Rechercher..."
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          style={{ width: 300, padding: 8 }}
        />
      </div>

      <MenusTable menus={menusFiltres} onEdit={ouvrirEdition} onDelete={supprimer} />

      {formulaireOuvert && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            overflowY: "auto",
            padding: "40px 0",
          }}
        >
          <MenuForm
            menu={menuEnEdition}
            onClose={() => setFormulaireOuvert(false)}
            onSave={chargerMenus}
          />
        </div>
      )}
    </div>
  );
}
