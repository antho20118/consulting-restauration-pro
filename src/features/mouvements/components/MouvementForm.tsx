import { useEffect, useState } from "react";
import { API_URL } from "../../../config/api";
import { creerMouvement } from "../services/mouvementService";
import type { TypeMouvement } from "../types/mouvement";

type Article = {
  id: number;
  nom: string;
};

type Depot = {
  id: number;
  nom: string;
};

type Props = {
  onClose: () => void;
  onSave: () => void;
};

export default function MouvementForm({ onClose, onSave }: Props) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [articleId, setArticleId] = useState(0);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState(0);
  const [type, setType] = useState<TypeMouvement>("ENTREE");
  const [quantite, setQuantite] = useState(0);
  const [motif, setMotif] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/articles`)
      .then((response) => response.json())
      .then((data) => {
        setArticles(data);
        if (data.length > 0) setArticleId(data[0].id);
      });

    fetch(`${API_URL}/depots`)
      .then((response) => response.json())
      .then((data) => {
        setDepots(data);
        if (data.length > 0) setDepotId(data[0].id);
      });
  }, []);

  async function enregistrer() {
    try {
      await creerMouvement({ articleId, depotId, type, quantite, motif });
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
        width: 420,
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "85vh",
        overflowY: "auto",
      }}
    >
      <h2>Nouveau mouvement</h2>

      <label>Ingrédient</label>
      <select
        value={articleId}
        onChange={(e) => setArticleId(Number(e.target.value))}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      >
        {articles.map((article) => (
          <option key={article.id} value={article.id}>
            {article.nom}
          </option>
        ))}
      </select>

      <label>Dépôt</label>
      <select
        value={depotId}
        onChange={(e) => setDepotId(Number(e.target.value))}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      >
        {depots.map((depot) => (
          <option key={depot.id} value={depot.id}>
            {depot.nom}
          </option>
        ))}
      </select>

      <label>Type</label>
      <select
        value={type}
        onChange={(e) => setType(e.target.value as TypeMouvement)}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      >
        <option value="ENTREE">Entrée</option>
        <option value="SORTIE">Sortie</option>
      </select>

      <label>Quantité</label>
      <input
        type="number"
        step="0.01"
        value={quantite}
        onChange={(e) => setQuantite(Number(e.target.value))}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <label>Motif</label>
      <input
        type="text"
        placeholder="ex. Réception livraison, casse, inventaire…"
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onClose}>Annuler</button>
        <button onClick={enregistrer}>Enregistrer</button>
      </div>
    </div>
  );
}
