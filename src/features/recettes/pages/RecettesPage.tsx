import { useEffect, useMemo, useState } from "react";
import RecettesGrille from "../components/RecettesGrille";
import RecetteForm from "../components/RecetteForm";
import RecetteDetail from "../components/RecetteDetail";
import ImporterRecetteModal from "../components/ImporterRecetteModal";
import { API_URL, apiFetch } from "../../../config/api";
import { getRecettes, supprimerRecette } from "../services/recetteService";
import { exporterExcel } from "../../../common/exportExcel";
import type { LigneRecetteInput, Recette } from "../types/recette";

type SousCategorieRecette = {
  id: number;
  nom: string;
};

type BrouillonImport = {
  nom?: string;
  portions?: number;
  lignes: LigneRecetteInput[];
  etapes: { description: string; pointCritiqueHACCP: boolean; controleHACCP: string | null }[];
};

export default function RecettesPage() {
  const [recettes, setRecettes] = useState<Recette[]>([]);
  const [recetteEnEdition, setRecetteEnEdition] = useState<Recette | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [brouillonImport, setBrouillonImport] = useState<BrouillonImport | undefined>(undefined);
  const [importOuvert, setImportOuvert] = useState(false);
  const [recetteConsultee, setRecetteConsultee] = useState<Recette | null>(null);
  const [recherche, setRecherche] = useState("");
  const [sousCategories, setSousCategories] = useState<SousCategorieRecette[]>([]);
  const [filtreSousCategorieId, setFiltreSousCategorieId] = useState(0);

  async function chargerRecettes() {
    const data = await getRecettes();
    setRecettes(data);
  }

  useEffect(() => {
    getRecettes().then(setRecettes);
    apiFetch(`${API_URL}/sous-categories-recette`)
      .then((r) => r.json())
      .then(setSousCategories);
  }, []);

  const recettesFiltrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    return recettes.filter((recette) => {
      if (terme && !recette.nom.toLowerCase().includes(terme)) return false;
      if (filtreSousCategorieId && recette.sousCategorieId !== filtreSousCategorieId) return false;
      return true;
    });
  }, [recettes, recherche, filtreSousCategorieId]);

  function ouvrirCreation() {
    setRecetteEnEdition(null);
    setBrouillonImport(undefined);
    setFormulaireOuvert(true);
  }

  function fermerFormulaire() {
    setFormulaireOuvert(false);
    setBrouillonImport(undefined);
  }

  function ouvrirEdition(recette: Recette) {
    setRecetteConsultee(null);
    setRecetteEnEdition(recette);
    setFormulaireOuvert(true);
  }

  async function supprimer(recette: Recette) {
    if (!confirm(`Supprimer la recette "${recette.nom}" ?`)) return;
    await supprimerRecette(recette.id);
    setRecetteConsultee(null);
    chargerRecettes();
  }

  async function exporter() {
    await exporterExcel(`recettes_${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        nom: "Recettes",
        lignes: recettesFiltrees.map((recette) => ({
          Nom: recette.nom,
          Catégorie: recette.categorie?.nom ?? "",
          "Sous-catégorie": recette.sousCategorie?.nom ?? "",
          Portions: recette.portions,
          "Coût total (€)": Number(recette.coutTotal.toFixed(2)),
          "Coût / portion (€)": Number(recette.coutParPortion.toFixed(2)),
          "Prix de vente HT (€)": recette.prixVenteHT ?? "",
          "Food cost (%)": recette.foodCostPct != null ? Number(recette.foodCostPct.toFixed(1)) : "",
          "Marge HT (€)": recette.margeHT != null ? Number(recette.margeHT.toFixed(2)) : "",
        })),
      },
      {
        nom: "Ingrédients par recette",
        lignes: recettesFiltrees.flatMap((recette) =>
          recette.lignes.map((ligne) => ({
            Recette: recette.nom,
            Ingrédient: ligne.article.nom,
            Quantité: ligne.quantite,
            Unité: ligne.unite.symbole,
            "Coût ligne (€)": Number(ligne.coutLigne.toFixed(2)),
          }))
        ),
      },
    ]);
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>📖 Fiches recettes</h1>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={ouvrirCreation}>+ Nouvelle recette</button>
          <button onClick={() => setImportOuvert(true)}>Importer une recette</button>
          <button onClick={exporter}>Exporter Excel</button>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <select
            value={filtreSousCategorieId}
            onChange={(e) => setFiltreSousCategorieId(Number(e.target.value))}
            style={{ padding: 8 }}
          >
            <option value={0}>Toutes les sous-catégories</option>
            {sousCategories.map((sousCategorie) => (
              <option key={sousCategorie.id} value={sousCategorie.id}>
                {sousCategorie.nom}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Rechercher..."
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            style={{ width: 300, padding: 8 }}
          />
        </div>
      </div>

      <RecettesGrille recettes={recettesFiltrees} onOuvrir={setRecetteConsultee} />

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
          <RecetteForm
            recette={recetteEnEdition}
            brouillon={brouillonImport}
            onClose={fermerFormulaire}
            onSave={chargerRecettes}
          />
        </div>
      )}

      {importOuvert && (
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
          <ImporterRecetteModal
            onClose={() => setImportOuvert(false)}
            onExtrait={(brouillon) => {
              setImportOuvert(false);
              setRecetteEnEdition(null);
              setBrouillonImport(brouillon);
              setFormulaireOuvert(true);
            }}
          />
        </div>
      )}

      {recetteConsultee && (
        <div
          className="fiche-technique-apercu-overlay"
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
          <RecetteDetail
            recette={recetteConsultee}
            onClose={() => setRecetteConsultee(null)}
            onEdit={ouvrirEdition}
            onDelete={supprimer}
          />
        </div>
      )}
    </div>
  );
}
