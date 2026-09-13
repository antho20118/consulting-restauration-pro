import toast from "react-hot-toast";
import { useEffect, useMemo, useState } from "react";
import { API_URL, apiFetch } from "../../../config/api";
import ChampNombre from "../../../common/ChampNombre";
import { getRecettes } from "../../recettes/services/recetteService";
import type { Recette } from "../../recettes/types/recette";
import { creerMenu, modifierMenu } from "../services/menuService";
import type { LigneMenuInput, Menu } from "../types/menu";

type CategorieRecette = {
  id: number;
  nom: string;
};

type Props = {
  menu: Menu | null;
  onClose: () => void;
  onSave: () => void;
};

export default function MenuForm({ menu, onClose, onSave }: Props) {
  const [nom, setNom] = useState(menu?.nom ?? "");
  const [description, setDescription] = useState(menu?.description ?? "");
  const [categorieId, setCategorieId] = useState<number>(menu?.categorieId ?? 0);
  const [prixVenteHT, setPrixVenteHT] = useState(menu?.prixVenteHT ?? 0);
  const [lignes, setLignes] = useState<LigneMenuInput[]>(
    menu?.lignes.map((ligne) => ({
      recetteId: ligne.recetteId,
      quantite: ligne.quantite,
    })) ?? []
  );

  const [categories, setCategories] = useState<CategorieRecette[]>([]);
  const [recettes, setRecettes] = useState<Recette[]>([]);

  useEffect(() => {
    apiFetch(`${API_URL}/categories-recette`)
      .then((r) => r.json())
      .then((data) => {
        setCategories(data);
        if (!menu && data.length > 0) setCategorieId(data[0].id);
      });

    getRecettes().then(setRecettes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ajouterLigne() {
    setLignes((precedent) => [
      ...precedent,
      {
        recetteId: recettes[0]?.id ?? 0,
        quantite: 1,
      },
    ]);
  }

  function retirerLigne(index: number) {
    setLignes((precedent) => precedent.filter((_, i) => i !== index));
  }

  function modifierLigne(index: number, changement: Partial<LigneMenuInput>) {
    setLignes((precedent) =>
      precedent.map((ligne, i) => (i === index ? { ...ligne, ...changement } : ligne))
    );
  }

  const coutTotal = useMemo(() => {
    return lignes.reduce((total, ligne) => {
      const recette = recettes.find((r) => r.id === ligne.recetteId);
      return total + (recette ? recette.coutParPortion * ligne.quantite : 0);
    }, 0);
  }, [lignes, recettes]);

  const foodCostPct = prixVenteHT > 0 ? (coutTotal / prixVenteHT) * 100 : null;

  async function enregistrer() {
    const payload = {
      nom,
      description: description || null,
      categorieId: categorieId || null,
      prixVenteHT: prixVenteHT || null,
      lignes,
    };

    try {
      if (menu) {
        await modifierMenu(menu.id, payload);
      } else {
        await creerMenu({ ...payload, societeId: 1 });
      }

      onSave();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  return (
    <div
      style={{
        background: "white",
        padding: 20,
        borderRadius: 10,
        width: 650,
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "85vh",
        overflowY: "auto",
      }}
    >
      <h2>{menu ? "Modifier le menu" : "Nouveau menu"}</h2>

      <label>Nom</label>
      <input
        type="text"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <label>Catégorie</label>
          <select
            value={categorieId}
            onChange={(e) => setCategorieId(Number(e.target.value))}
            style={{ width: "100%", padding: 10 }}
          >
            {categories.map((categorie) => (
              <option key={categorie.id} value={categorie.id}>
                {categorie.nom}
              </option>
            ))}
          </select>
        </div>

        <div style={{ width: 160 }}>
          <label>Prix de vente HT (€/pers.)</label>
          <ChampNombre
            valeur={prixVenteHT}
            onChanger={(n) => setPrixVenteHT(n ?? 0)}
            style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
          />
        </div>
      </div>

      <h3>Recettes du menu</h3>

      {lignes.map((ligne, index) => {
        const recette = recettes.find((r) => r.id === ligne.recetteId);
        const cout = recette ? recette.coutParPortion * ligne.quantite : 0;

        return (
          <div
            key={index}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <select
              value={ligne.recetteId}
              onChange={(e) => modifierLigne(index, { recetteId: Number(e.target.value) })}
              style={{ flex: 2, padding: 8 }}
            >
              {recettes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nom}
                </option>
              ))}
            </select>

            <ChampNombre
              valeur={ligne.quantite}
              onChanger={(n) => modifierLigne(index, { quantite: n ?? 0 })}
              style={{ width: 90, padding: 8, boxSizing: "border-box" }}
            />

            <span style={{ width: 70, textAlign: "right", color: "#555" }}>
              {cout.toFixed(2)} €
            </span>

            <button onClick={() => retirerLigne(index)}>✕</button>
          </div>
        );
      })}

      <button onClick={ajouterLigne} style={{ display: "block", marginBottom: 20 }}>
        + Ajouter une recette
      </button>

      <label>Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <div
        style={{
          background: "#f4f6f8",
          borderRadius: 8,
          padding: 12,
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>Coût matière (par pers.) : <strong>{coutTotal.toFixed(2)} €</strong></span>
        <span>Food cost : <strong>{foodCostPct != null ? `${foodCostPct.toFixed(1)} %` : "—"}</strong></span>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={enregistrer}>Enregistrer</button>
      </div>
    </div>
  );
}
