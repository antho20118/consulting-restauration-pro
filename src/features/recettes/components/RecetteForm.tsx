import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../../../config/api";
import {
  creerRecette,
  getArticlesDisponibles,
  getUnitesDisponibles,
  modifierRecette,
} from "../services/recetteService";
import { estimerCoutLigne } from "../utils/cout";
import type { ArticleRecette, LigneRecetteInput, Recette, UniteRecette } from "../types/recette";

type Categorie = {
  id: number;
  nom: string;
};

type Props = {
  recette: Recette | null;
  onClose: () => void;
  onSave: () => void;
};

export default function RecetteForm({ recette, onClose, onSave }: Props) {
  const [nom, setNom] = useState(recette?.nom ?? "");
  const [categorieId, setCategorieId] = useState<number>(recette?.categorieId ?? 0);
  const [portions, setPortions] = useState(recette?.portions ?? 1);
  const [prixVenteHT, setPrixVenteHT] = useState(recette?.prixVenteHT ?? 0);
  const [instructions, setInstructions] = useState(recette?.instructions ?? "");
  const [lignes, setLignes] = useState<LigneRecetteInput[]>(
    recette?.lignes.map((ligne) => ({
      articleId: ligne.articleId,
      quantite: ligne.quantite,
      uniteId: ligne.uniteId,
    })) ?? []
  );

  const [categories, setCategories] = useState<Categorie[]>([]);
  const [articles, setArticles] = useState<ArticleRecette[]>([]);
  const [unites, setUnites] = useState<UniteRecette[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/categories`)
      .then((r) => r.json())
      .then((data) => {
        setCategories(data);
        if (!recette && data.length > 0) setCategorieId(data[0].id);
      });

    getArticlesDisponibles().then(setArticles);

    getUnitesDisponibles().then((data) => {
      setUnites(data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ajouterLigne() {
    setLignes((precedent) => [
      ...precedent,
      {
        articleId: articles[0]?.id ?? 0,
        quantite: 0,
        uniteId: unites[0]?.id ?? 0,
      },
    ]);
  }

  function retirerLigne(index: number) {
    setLignes((precedent) => precedent.filter((_, i) => i !== index));
  }

  function modifierLigne(index: number, changement: Partial<LigneRecetteInput>) {
    setLignes((precedent) =>
      precedent.map((ligne, i) => (i === index ? { ...ligne, ...changement } : ligne))
    );
  }

  const coutTotal = useMemo(() => {
    return lignes.reduce((total, ligne) => {
      const article = articles.find((a) => a.id === ligne.articleId);
      const unite = unites.find((u) => u.id === ligne.uniteId);
      return total + estimerCoutLigne(article, ligne.quantite, unite);
    }, 0);
  }, [lignes, articles, unites]);

  const coutParPortion = portions > 0 ? coutTotal / portions : coutTotal;

  async function enregistrer() {
    const payload = {
      nom,
      categorieId: categorieId || null,
      portions,
      prixVenteHT: prixVenteHT || null,
      instructions: instructions || null,
      lignes,
    };

    try {
      if (recette) {
        await modifierRecette(recette.id, payload);
      } else {
        await creerRecette({ ...payload, societeId: 1 });
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
        width: 650,
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "85vh",
        overflowY: "auto",
      }}
    >
      <h2>{recette ? "Modifier la recette" : "Nouvelle recette"}</h2>

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

        <div style={{ width: 120 }}>
          <label>Portions</label>
          <input
            type="number"
            min={1}
            value={portions}
            onChange={(e) => setPortions(Number(e.target.value))}
            style={{ width: "100%", padding: 10 }}
          />
        </div>

        <div style={{ width: 160 }}>
          <label>Prix de vente HT (€)</label>
          <input
            type="number"
            step="0.01"
            value={prixVenteHT}
            onChange={(e) => setPrixVenteHT(Number(e.target.value))}
            style={{ width: "100%", padding: 10 }}
          />
        </div>
      </div>

      <h3>Ingrédients</h3>

      {lignes.map((ligne, index) => {
        const article = articles.find((a) => a.id === ligne.articleId);
        const unite = unites.find((u) => u.id === ligne.uniteId);
        const cout = estimerCoutLigne(article, ligne.quantite, unite);

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
              value={ligne.articleId}
              onChange={(e) => modifierLigne(index, { articleId: Number(e.target.value) })}
              style={{ flex: 2, padding: 8 }}
            >
              {articles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nom}
                </option>
              ))}
            </select>

            <input
              type="number"
              step="0.01"
              value={ligne.quantite}
              onChange={(e) => modifierLigne(index, { quantite: Number(e.target.value) })}
              style={{ width: 90, padding: 8 }}
            />

            <select
              value={ligne.uniteId}
              onChange={(e) => modifierLigne(index, { uniteId: Number(e.target.value) })}
              style={{ width: 100, padding: 8 }}
            >
              {unites.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.symbole}
                </option>
              ))}
            </select>

            <span style={{ width: 70, textAlign: "right", color: "#555" }}>
              {cout.toFixed(2)} €
            </span>

            <button onClick={() => retirerLigne(index)}>✕</button>
          </div>
        );
      })}

      <button onClick={ajouterLigne} style={{ marginBottom: 20 }}>
        + Ajouter un ingrédient
      </button>

      <label>Instructions</label>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={4}
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
        <span>Coût matière total : <strong>{coutTotal.toFixed(2)} €</strong></span>
        <span>Coût par portion : <strong>{coutParPortion.toFixed(2)} €</strong></span>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onClose}>Annuler</button>
        <button onClick={enregistrer}>Enregistrer</button>
      </div>
    </div>
  );
}
