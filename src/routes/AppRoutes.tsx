import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";

import MainLayout from "../layouts/MainLayout";
import PageLoader from "../common/PageLoader";

const DashboardPage = lazy(() => import("../features/dashboard/pages/DashboardPage"));
const IngredientsPage = lazy(() => import("../features/ingredients/pages/IngredientsPage"));
const RecettesPage = lazy(() => import("../features/recettes/pages/RecettesPage"));
const MenusPage = lazy(() => import("../features/menus/pages/MenusPage"));
const FournisseursPage = lazy(() => import("../features/fournisseurs/pages/FournisseursPage"));
const FournisseurDetailPage = lazy(() => import("../features/fournisseurs/pages/FournisseurDetailPage"));
const MouvementsPage = lazy(() => import("../features/mouvements/pages/MouvementsPage"));
const DepotsPage = lazy(() => import("../features/depots/pages/DepotsPage"));
const ParametresPage = lazy(() => import("../features/parametres/pages/ParametresPage"));
const ProductionPage = lazy(() => import("../features/production/pages/ProductionPage"));
const ProductionPlanifierPage = lazy(() => import("../features/production/pages/ProductionPlanifierPage"));
const HaccpPage = lazy(() => import("../features/haccp/pages/HaccpPage"));
const CommandesPage = lazy(() => import("../features/commandes/pages/CommandesPage"));
const CommandeDetailPage = lazy(() => import("../features/commandes/pages/CommandeDetailPage"));
const ProductionsPage = lazy(() => import("../features/productions/pages/ProductionsPage"));
const ProductionDetailPage = lazy(() => import("../features/productions/pages/ProductionDetailPage"));

export default function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="recettes" element={<RecettesPage />} />
          <Route path="menus" element={<MenusPage />} />
          <Route path="ingredients" element={<IngredientsPage />} />
          <Route path="fournisseurs" element={<FournisseursPage />} />
          <Route path="fournisseurs/:id" element={<FournisseurDetailPage />} />
          <Route path="mouvements" element={<MouvementsPage />} />
          <Route path="depots" element={<DepotsPage />} />
          <Route path="production" element={<ProductionPage />} />
          <Route path="production/:recetteId" element={<ProductionPlanifierPage />} />
          <Route path="haccp" element={<HaccpPage />} />
          <Route path="commandes" element={<CommandesPage />} />
          <Route path="commandes/:id" element={<CommandeDetailPage />} />
          <Route path="productions" element={<ProductionsPage />} />
          <Route path="productions/:id" element={<ProductionDetailPage />} />
          <Route path="parametres" element={<ParametresPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
