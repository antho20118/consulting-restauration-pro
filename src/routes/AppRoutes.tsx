import { Routes, Route } from "react-router-dom";

import MainLayout from "../layouts/MainLayout";
import IngredientsPage from "../features/ingredients/pages/IngredientsPage";

function Dashboard() {
  return <h1>🏠 Tableau de bord</h1>;
}

function Recipes() {
  return <h1>📖 Fiches techniques</h1>;
}

function Settings() {
  return <h1>⚙ Paramètres</h1>;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="recettes" element={<Recipes />} />
        <Route path="ingredients" element={<IngredientsPage />} />
        <Route path="parametres" element={<Settings />} />
      </Route>
    </Routes>
  );
}