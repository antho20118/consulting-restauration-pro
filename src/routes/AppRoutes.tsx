import { lazy, Suspense, type ReactElement } from "react";
import { Navigate, Routes, Route } from "react-router-dom";

import MainLayout from "../layouts/MainLayout";
import PageLoader from "../common/PageLoader";
import { voitLesTarifs } from "../config/api";

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
const VentesPage = lazy(() => import("../features/ventes/pages/VentesPage"));
const MenuEngineeringPage = lazy(() => import("../features/ventes/pages/MenuEngineeringPage"));
const QuestionsPage = lazy(() => import("../features/questions/pages/QuestionsPage"));
const PrevisionsPage = lazy(() => import("../features/ventes/pages/PrevisionsPage"));
const SaisiesEnAttentePage = lazy(() => import("../features/saisies/pages/SaisiesEnAttentePage"));

// Écrans de gestion (achats, fournisseurs, ventes, analyses, tableau de bord, base ingrédients,
// dépôts) : fermés au cuisinier (décision du 15/10, voir voitLesTarifs) — renvoyé aux fiches
// recettes plutôt que vers une page vide ou refusée par le serveur.
function HorsCuisinier({ children }: { children: ReactElement }) {
  return voitLesTarifs() ? children : <Navigate to="/recettes" replace />;
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<HorsCuisinier><DashboardPage /></HorsCuisinier>} />
          <Route path="recettes" element={<RecettesPage />} />
          <Route path="menus" element={<MenusPage />} />
          <Route path="ingredients" element={<HorsCuisinier><IngredientsPage /></HorsCuisinier>} />
          <Route path="fournisseurs" element={<HorsCuisinier><FournisseursPage /></HorsCuisinier>} />
          <Route path="fournisseurs/:id" element={<HorsCuisinier><FournisseurDetailPage /></HorsCuisinier>} />
          <Route path="mouvements" element={<MouvementsPage />} />
          <Route path="depots" element={<HorsCuisinier><DepotsPage /></HorsCuisinier>} />
          <Route path="production" element={<ProductionPage />} />
          <Route path="production/:recetteId" element={<ProductionPlanifierPage />} />
          <Route path="haccp" element={<HaccpPage />} />
          <Route path="commandes" element={<HorsCuisinier><CommandesPage /></HorsCuisinier>} />
          <Route path="commandes/:id" element={<HorsCuisinier><CommandeDetailPage /></HorsCuisinier>} />
          <Route path="productions" element={<ProductionsPage />} />
          <Route path="productions/:id" element={<ProductionDetailPage />} />
          <Route path="ventes" element={<HorsCuisinier><VentesPage /></HorsCuisinier>} />
          <Route path="menu-engineering" element={<HorsCuisinier><MenuEngineeringPage /></HorsCuisinier>} />
          <Route path="previsions" element={<HorsCuisinier><PrevisionsPage /></HorsCuisinier>} />
          <Route path="questions" element={<HorsCuisinier><QuestionsPage /></HorsCuisinier>} />
          <Route path="saisies-en-attente" element={<SaisiesEnAttentePage />} />
          <Route path="parametres" element={<ParametresPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
