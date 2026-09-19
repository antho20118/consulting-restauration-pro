import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import IngredientsTable from "../components/IngredientsTable";
import IngredientForm from "../components/IngredientForm";
import ImportListingModal from "../components/ImportListingModal";
import {
  getIngredients,
  supprimerIngredient,
  supprimerTousLesArticles,
} from "../services/ingredientService";
import { exporterExcel } from "../../../common/exportExcel";
import type { Ingredient } from "../types/ingredient";

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientEnEdition, setIngredientEnEdition] = useState<Ingredient | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [importOuvert, setImportOuvert] = useState(false);
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

  // Suppression définitive (pas la suppression douce individuelle ci-dessus) : les articles déjà
  // utilisés dans une recette sont protégés côté serveur, mais le reste est vraiment effacé, d'où
  // une confirmation renforcée plutôt qu'un simple OK/Annuler.
  async function supprimerTout() {
    const saisie = prompt(
      `Supprimer définitivement les ${ingredients.length} article(s) ? Ceux déjà utilisés dans une recette seront conservés. Cette action est irréversible pour les autres.\n\nTape SUPPRIMER pour confirmer.`
    );
    if (saisie !== "SUPPRIMER") return;

    const { supprimes, proteges } = await supprimerTousLesArticles();
    toast.success(
      `${supprimes} article(s) supprimé(s)` +
        (proteges > 0 ? `, ${proteges} conservé(s) car utilisé(s) dans une recette.` : ".")
    );
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
          Stock: ingredient.stocks?.reduce((total, stock) => total + stock.quantite, 0) ?? 0,
          Allergènes: ingredient.allergenes.map((a) => a.allergene.nom).join(", "),
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
          <button className="btn-primary" onClick={ouvrirCreation}>
            + Nouvel ingrédient
          </button>
          <button onClick={() => setImportOuvert(true)}>Importer un listing</button>
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

      {ingredients.length > 0 && (
        <div style={{ textAlign: "right", marginBottom: 10 }}>
          <button
            onClick={supprimerTout}
            style={{ fontSize: 12, color: "#b00020", background: "none", border: "none", cursor: "pointer" }}
          >
            Supprimer tous les articles ({ingredients.length})
          </button>
        </div>
      )}

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
          <ImportListingModal
            onClose={() => setImportOuvert(false)}
            onSave={chargerIngredients}
          />
        </div>
      )}
    </div>
  );
}
