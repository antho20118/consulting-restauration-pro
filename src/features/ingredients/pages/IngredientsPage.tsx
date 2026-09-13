import { useEffect, useMemo, useState } from "react";
import IngredientsTable from "../components/IngredientsTable";
import IngredientForm from "../components/IngredientForm";
import { getIngredients } from "../services/ingredientService";
import type { Ingredient } from "../types/ingredient";

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [open, setOpen] = useState(false);
  const [recherche, setRecherche] = useState("");

  async function chargerIngredients() {
    const data = await getIngredients();
    setIngredients(data);
  }

  useEffect(() => {
    chargerIngredients();
  }, []);

  const ingredientsFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return ingredients;
    return ingredients.filter((ingredient) =>
      ingredient.nom.toLowerCase().includes(terme)
    );
  }, [ingredients, recherche]);

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
        <button onClick={() => setOpen(true)}>
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

      <IngredientsTable ingredients={ingredientsFiltres} />

      {open && (
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
            onClose={() => setOpen(false)}
            onSave={chargerIngredients}
          />
        </div>
      )}
    </div>
  );
}