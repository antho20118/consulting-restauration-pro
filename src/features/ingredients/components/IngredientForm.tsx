import { useEffect, useState } from "react";
import { API_URL } from "../../../config/api";
import { creerIngredient, getAllergenes, modifierIngredient } from "../services/ingredientService";
import type { Allergene, Ingredient } from "../types/ingredient";

type Categorie = {
  id: number;
  nom: string;
};

type Unite = {
  id: number;
  nom: string;
  symbole: string;
};

type Props = {
  ingredient: Ingredient | null;
  onClose: () => void;
  onSave: () => void;
};

export default function IngredientForm({ ingredient, onClose, onSave }: Props) {
  const [nom, setNom] = useState(ingredient?.nom ?? "");
  const [reference, setReference] = useState(ingredient?.reference ?? "");
  const [prixHT, setPrixHT] = useState(ingredient?.tarifs[0]?.prixHT ?? 0);
  const [stockInitial, setStockInitial] = useState(ingredient?.stocks?.[0]?.quantite ?? 0);
  const [rendement, setRendement] = useState(ingredient?.rendement ?? 100);
  const [fournisseurNom, setFournisseurNom] = useState(ingredient?.tarifs[0]?.fournisseur.nom ?? "");

  const [categories, setCategories] = useState<Categorie[]>([]);
  const [categorieId, setCategorieId] = useState(ingredient?.categorie.id ?? 0);

  const [unites, setUnites] = useState<Unite[]>([]);
  const [uniteId, setUniteId] = useState(ingredient?.tarifs[0]?.unite.id ?? 0);

  const [allergenes, setAllergenes] = useState<Allergene[]>([]);
  const [allergeneIds, setAllergeneIds] = useState<number[]>(
    ingredient?.allergenes.map((a) => a.allergene.id) ?? []
  );

  useEffect(() => {
    fetch(`${API_URL}/categories`)
      .then((response) => response.json())
      .then((data) => {
        setCategories(data);
        if (!ingredient && data.length > 0) setCategorieId(data[0].id);
      });

    fetch(`${API_URL}/unites`)
      .then((response) => response.json())
      .then((data) => {
        setUnites(data);
        if (!ingredient && data.length > 0) setUniteId(data[0].id);
      });

    getAllergenes().then(setAllergenes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function basculerAllergene(id: number) {
    setAllergeneIds((precedent) =>
      precedent.includes(id) ? precedent.filter((a) => a !== id) : [...precedent, id]
    );
  }

  async function enregistrer() {
    const payload = {
      nom,
      reference,
      categorieId,
      rendement,
      uniteId,
      fournisseurNom,
      prixHT,
      stockInitial,
      allergeneIds,
    };

    try {
      if (ingredient) {
        await modifierIngredient(ingredient.id, payload);
      } else {
        await creerIngredient({ ...payload, tvaId: 1, societeId: 1, type: "MATIERE_PREMIERE" });
      }

      onSave();
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  return (
    <div
      style={{
        background: "white",
        padding: 20,
        borderRadius: 10,
        width: 450,
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "85vh",
        overflowY: "auto",
      }}
    >
      <h2>{ingredient ? "Modifier l'ingrédient" : "Nouvel ingrédient"}</h2>

      <label>Nom</label>
      <input
        type="text"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        style={{
          width: "100%",
          padding: 10,
          marginBottom: 20,
        }}
      />

      <label>Référence</label>
      <input
        type="text"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        style={{
          width: "100%",
          padding: 10,
          marginBottom: 20,
        }}
      />

      <label>Catégorie</label>
      <select
        value={categorieId}
        onChange={(e) => setCategorieId(Number(e.target.value))}
        style={{
          width: "100%",
          padding: 10,
          marginBottom: 20,
        }}
      >
        {categories.map((categorie) => (
          <option key={categorie.id} value={categorie.id}>
            {categorie.nom}
          </option>
        ))}
      </select>

      <label>Unité</label>
      <select
        value={uniteId}
        onChange={(e) => setUniteId(Number(e.target.value))}
        style={{
          width: "100%",
          padding: 10,
          marginBottom: 20,
        }}
      >
        {unites.map((unite) => (
          <option key={unite.id} value={unite.id}>
            {unite.nom} ({unite.symbole})
          </option>
        ))}
      </select>

      <label>Fournisseur</label>
      <input
        type="text"
        placeholder="ex. Metro, Pomona…"
        value={fournisseurNom}
        onChange={(e) => setFournisseurNom(e.target.value)}
        style={{
          width: "100%",
          padding: 10,
          marginBottom: 20,
        }}
      />

      <label>Prix HT (€)</label>
      <input
        type="number"
        step="0.01"
        value={prixHT}
        onChange={(e) => setPrixHT(Number(e.target.value))}
        style={{
          width: "100%",
          padding: 10,
          marginBottom: 20,
        }}
      />

      <label>Stock initial</label>
      <input
        type="number"
        step="0.01"
        value={stockInitial}
        onChange={(e) => setStockInitial(Number(e.target.value))}
        style={{
          width: "100%",
          padding: 10,
          marginBottom: 20,
        }}
      />

      <label>Rendement (%)</label>
      <input
        type="number"
        value={rendement}
        onChange={(e) => setRendement(Number(e.target.value))}
        style={{
          width: "100%",
          padding: 10,
          marginBottom: 20,
        }}
      />

      <label>Allergènes</label>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 16px",
          marginBottom: 20,
        }}
      >
        {allergenes.map((allergene) => (
          <label
            key={allergene.id}
            style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: "normal" }}
          >
            <input
              type="checkbox"
              checked={allergeneIds.includes(allergene.id)}
              onChange={() => basculerAllergene(allergene.id)}
            />
            {allergene.nom}
          </label>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
        }}
      >
        <button onClick={onClose}>Annuler</button>
        <button onClick={enregistrer}>Enregistrer</button>
      </div>
    </div>
  );
}
