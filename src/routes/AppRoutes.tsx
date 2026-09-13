import { Routes, Route } from "react-router-dom";

import MainLayout from "../layouts/MainLayout";
import DashboardPage from "../features/dashboard/pages/DashboardPage";
import IngredientsPage from "../features/ingredients/pages/IngredientsPage";
import RecettesPage from "../features/recettes/pages/RecettesPage";
import MenusPage from "../features/menus/pages/MenusPage";
import FournisseursPage from "../features/fournisseurs/pages/FournisseursPage";
import MouvementsPage from "../features/mouvements/pages/MouvementsPage";
import DepotsPage from "../features/depots/pages/DepotsPage";
import ParametresPage from "../features/parametres/pages/ParametresPage";

export default function AppRoutes() {
  return (
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
  );
}