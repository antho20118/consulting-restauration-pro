import { useEffect, useMemo, useState } from "react";
import RecettesTable from "../components/RecettesTable";
import RecetteForm from "../components/RecetteForm";
import { getRecettes, supprimerRecette } from "../services/recetteService";
import type { Recette } from "../types/recette";

export default function RecettesPage() {
  const [recettes, setRecettes] = useState<Recette[]>([]);
  const [recetteEnEdition, setRecetteEnEdition] = useState<Recette | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");

  async function chargerRecettes() {
    const data = await getRecettes();
    setRecettes(data);
  }

  useEffect(() => {
    chargerRecettes();
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
        <button onClick={ouvrirCreation}>+ Nouvelle recette</button>

        <input
          type="text"
          placeholder="Rechercher..."
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          style={{ width: 300, padding: 8 }}
        />
      </div>

      <RecettesTable recettes={recettesFiltrees} onEdit={ouvrirEdition} onDelete={supprimer} />

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
    </div>
  );
}
