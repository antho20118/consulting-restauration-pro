import { useEffect, useState } from "react";
import { API_URL } from "../../../config/api";

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
  onClose: () => void;
  onSave: () => void;
};

export default function IngredientForm({ onClose, onSave }: Props) {
  const [nom, setNom] = useState("");
  const [reference, setReference] = useState("");
  const [prixHT, setPrixHT] = useState(0);
  const [stockInitial, setStockInitial] = useState(0);
  const [rendement, setRendement] = useState(100);
  const [fournisseurNom, setFournisseurNom] = useState("");

  const [categories, setCategories] = useState<Categorie[]>([]);
  const [categorieId, setCategorieId] = useState(0);

  const [unites, setUnites] = useState<Unite[]>([]);
  const [uniteId, setUniteId] = useState(0);

  useEffect(() => {
    fetch(`${API_URL}/categories`)
      .then((response) => response.json())
      .then((data) => {
        setCategories(data);
        if (data.length > 0) setCategorieId(data[0].id);
      });

    fetch(`${API_URL}/unites`)
      .then((response) => response.json())
      .then((data) => {
        setUnites(data);
        if (data.length > 0) setUniteId(data[0].id);
      });
  }, []);

  async function enregistrer() {
    const response = await fetch(`${API_URL}/articles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nom,
        reference,
        categorieId,
        tvaId: 1,
        societeId: 1,
        rendement,
        type: "MATIERE_PREMIERE",
        uniteId,
        fournisseurNom,
        prixHT,
        stockInitial,
      }),
    });

    const resultat = await response.json();

    console.log(resultat);

    if (!response.ok) {
      alert(JSON.stringify(resultat, null, 2));
      return;
    }

    console.log("Article créé :", resultat);

    onSave();
    onClose();
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
      <h2>Nouvel ingrédient</h2>

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
