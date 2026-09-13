import { Routes, Route } from "react-router-dom";

import MainLayout from "../layouts/MainLayout";
import DashboardPage from "../features/dashboard/pages/DashboardPage";
import IngredientsPage from "../features/ingredients/pages/IngredientsPage";
import RecettesPage from "../features/recettes/pages/RecettesPage";
import FournisseursPage from "../features/fournisseurs/pages/FournisseursPage";
import MouvementsPage from "../features/mouvements/pages/MouvementsPage";
import ParametresPage from "../features/parametres/pages/ParametresPage";

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="recettes" element={<RecettesPage />} />
        <Route path="ingredients" element={<IngredientsPage />} />
        <Route path="fournisseurs" element={<FournisseursPage />} />
        <Route path="mouvements" element={<MouvementsPage />} />
        <Route path="parametres" element={<ParametresPage />} />
      </Route>
    </Routes>
  );
}