import { Routes, Route } from "react-router-dom";

import MainLayout from "../layouts/MainLayout";
import DashboardPage from "../features/dashboard/pages/DashboardPage";
import IngredientsPage from "../features/ingredients/pages/IngredientsPage";
import RecettesPage from "../features/recettes/pages/RecettesPage";

function Settings() {
  return <h1>⚙ Paramètres</h1>;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="recettes" element={<RecettesPage />} />
        <Route path="ingredients" element={<IngredientsPage />} />
        <Route path="parametres" element={<Settings />} />
      </Route>
    </Routes>
  );
}