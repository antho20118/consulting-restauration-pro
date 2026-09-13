import { useEffect, useMemo, useState } from "react";
import IngredientsTable from "../components/IngredientsTable";
import IngredientForm from "../components/IngredientForm";
import { getIngredients, supprimerIngredient } from "../services/ingredientService";
import { exporterExcel } from "../../../common/exportExcel";
import type { Ingredient } from "../types/ingredient";

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientEnEdition, setIngredientEnEdition] = useState<Ingredient | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");

  async function chargerIngredients() {
    const data = await getIngredients();
    setIngredients(data);
  }

  useEffect(() => {
    getIngredients().then(setIngredients);
  }, []);

  const ingredientsFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return ingredients;
    return ingredients.filter((ingredient) =>
      ingredient.nom.toLowerCase().includes(terme)
    );
  }, [ingredients, recherche]);

  function ouvrirCreation() {
    setIngredientEnEdition(null);
    setFormulaireOuvert(true);
  }

  function ouvrirEdition(ingredient: Ingredient) {
    setIngredientEnEdition(ingredient);
    setFormulaireOuvert(true);
  }

  async function supprimer(ingredient: Ingredient) {
    if (!confirm(`Supprimer l'ingrédient "${ingredient.nom}" ?`)) return;
    await supprimerIngredient(ingredient.id);
    chargerIngredients();
  }

  async function exporter() {
    await exporterExcel(`ingredients_${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        nom: "Ingrédients",
        lignes: ingredientsFiltres.map((ingredient) => ({
          Nom: ingredient.nom,
          Référence: ingredient.reference ?? "",
          Catégorie: ingredient.categorie?.nom ?? "",
          Unité: ingredient.tarifs[0]?.unite.symbole ?? "",
          Fournisseur: ingredient.tarifs[0]?.fournisseur.nom ?? "",
          "Prix HT (€)": ingredient.tarifs[0]?.prixHT ?? 0,
          Stock: ingredient.stocks?.[0]?.quantite ?? 0,
        })),
      },
    ]);
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>🥕 Base ingrédients</h1>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={ouvrirCreation}>
            + Nouvel ingrédient
          </button>
          <button onClick={exporter}>Exporter Excel</button>
        </div>

        <input
          type="text"
          placeholder="Rechercher..."
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          style={{
            width: 300,
            padding: 8,
          }}
        />
      </div>

      <IngredientsTable
        ingredients={ingredientsFiltres}
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
          <IngredientForm
            ingredient={ingredientEnEdition}
            onClose={() => setFormulaireOuvert(false)}
            onSave={chargerIngredients}
          />
        </div>
      )}
    </div>
  );
}
