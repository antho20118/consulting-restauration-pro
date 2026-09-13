import { useEffect, useState } from "react";
import KpiCard from "../components/KpiCard";
import RepartitionCategories from "../components/RepartitionCategories";
import RecettesAlerteTable from "../components/RecettesAlerteTable";
import PageLoader from "../../../common/PageLoader";
import { getDashboard } from "../services/dashboardService";
import type { DashboardData } from "../types/dashboard";

export default function DashboardPage() {
  const [donnees, setDonnees] = useState<DashboardData | null>(null);

  useEffect(() => {
    getDashboard().then(setDonnees);
  }, []);

  if (!donnees) {
    return (
      <div style={{ padding: 20 }}>
        <h1>🏠 Tableau de bord</h1>
        <PageLoader />
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>🏠 Tableau de bord</h1>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 30 }}>
        <KpiCard label="Ingrédients actifs" value={String(donnees.nbIngredients)} />
        <KpiCard label="Recettes actives" value={String(donnees.nbRecettes)} />
        <KpiCard label="Valeur du stock" value={`${donnees.valeurStock.toFixed(2)} €`} />
        <KpiCard
          label="Food cost moyen"
          value={donnees.foodCostMoyen != null ? `${donnees.foodCostMoyen.toFixed(1)} %` : "—"}
          hint="Sur les recettes avec un prix de vente renseigné"
        />
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <div
          style={{
            flex: 2,
            minWidth: 320,
            background: "white",
            borderRadius: 10,
            padding: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,.08)",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Recettes à surveiller</h3>
          <RecettesAlerteTable recettes={donnees.recettesAlerte} />
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 260,
            background: "white",
            borderRadius: 10,
            padding: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,.08)",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Recettes par catégorie</h3>
          <RepartitionCategories repartition={donnees.repartitionCategories} />
        </div>
      </div>
    </div>
  );
}
