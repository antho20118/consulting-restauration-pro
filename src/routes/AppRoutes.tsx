import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";

import MainLayout from "../layouts/MainLayout";
import PageLoader from "../common/PageLoader";

const DashboardPage = lazy(() => import("../features/dashboard/pages/DashboardPage"));
const IngredientsPage = lazy(() => import("../features/ingredients/pages/IngredientsPage"));
const RecettesPage = lazy(() => import("../features/recettes/pages/RecettesPage"));
const MenusPage = lazy(() => import("../features/menus/pages/MenusPage"));
const FournisseursPage = lazy(() => import("../features/fournisseurs/pages/FournisseursPage"));
const MouvementsPage = lazy(() => import("../features/mouvements/pages/MouvementsPage"));
const DepotsPage = lazy(() => import("../features/depots/pages/DepotsPage"));
const ParametresPage = lazy(() => import("../features/parametres/pages/ParametresPage"));

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
          <Route path="mouvements" element={<MouvementsPage />} />
          <Route path="depots" element={<DepotsPage />} />
          <Route path="parametres" element={<ParametresPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
