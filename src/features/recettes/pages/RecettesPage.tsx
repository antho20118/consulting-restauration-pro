import { useEffect, useMemo, useState } from "react";
import RecettesTable from "../components/RecettesTable";
import RecetteForm from "../components/RecetteForm";
import RecetteDetail from "../components/RecetteDetail";
import { getRecettes, supprimerRecette } from "../services/recetteService";
import { exporterExcel } from "../../../common/exportExcel";
import type { Recette } from "../types/recette";

export default function RecettesPage() {
  const [recettes, setRecettes] = useState<Recette[]>([]);
  const [recetteEnEdition, setRecetteEnEdition] = useState<Recette | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [recetteConsultee, setRecetteConsultee] = useState<Recette | null>(null);
  const [recherche, setRecherche] = useState("");

  async function chargerRecettes() {
    const data = await getRecettes();
    setRecettes(data);
  }

  useEffect(() => {
    getRecettes().then(setRecettes);
  }, []);

  const recettesFiltrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return recettes;
    return recettes.filter((recette) => recette.nom.toLowerCase().includes(terme));
  }, [recettes, recherche]);

  function ouvrirCreation() {
    setRecetteEnEdition(null);
    setFormulaireOuvert(true);
  }

  function ouvrirEdition(recette: Recette) {
    setRecetteEnEdition(recette);
    setFormulaireOuvert(true);
  }

  async function supprimer(recette: Recette) {
    if (!confirm(`Supprimer la recette "${recette.nom}" ?`)) return;
    await supprimerRecette(recette.id);
    chargerRecettes();
  }

  async function exporter() {
    await exporterExcel(`recettes_${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        nom: "Recettes",
        lignes: recettesFiltrees.map((recette) => ({
          Nom: recette.nom,
          Catégorie: recette.categorie?.nom ?? "",
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
      <h1>📖 Fiches techniques</h1>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={ouvrirCreation}>+ Nouvelle recette</button>
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

      <RecettesTable
        recettes={recettesFiltrees}
        onView={setRecetteConsultee}
        onEdit={ouvrirEdition}
        onDelete={supprimer}
      />

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
            onClose={() => setFormulaireOuvert(false)}
            onSave={chargerRecettes}
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
          <RecetteDetail recette={recetteConsultee} onClose={() => setRecetteConsultee(null)} />
        </div>
      )}
    </div>
  );
}
