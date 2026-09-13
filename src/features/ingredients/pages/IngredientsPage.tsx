import { useEffect, useMemo, useState } from "react";
import IngredientsTable from "../components/IngredientsTable";
import IngredientForm from "../components/IngredientForm";
import { getIngredients, supprimerIngredient } from "../services/ingredientService";
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
        <button onClick={ouvrirCreation}>
          + Nouvel ingrédient
        </button>

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
