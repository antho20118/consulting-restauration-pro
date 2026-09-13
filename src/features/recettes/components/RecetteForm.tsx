import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../../../config/api";
import ChampNombre from "../../../common/ChampNombre";
import { redimensionnerImage } from "../../../common/redimensionnerImage";
import {
  creerRecette,
  getArticlesDisponibles,
  getUnitesDisponibles,
  modifierRecette,
} from "../services/recetteService";
import { estimerCoutLigne } from "../utils/cout";
import RechercheArticle from "./RechercheArticle";
import type {
  ArticleRecette,
  EtapeRecetteInput,
  LigneRecetteInput,
  Recette,
  UniteRecette,
} from "../types/recette";

type CategorieRecette = {
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
  const [photo, setPhoto] = useState<string | null>(recette?.photo ?? null);
  const [lignes, setLignes] = useState<LigneRecetteInput[]>(
    recette?.lignes.map((ligne) => ({
      articleId: ligne.articleId,
      quantite: ligne.quantite,
      uniteId: ligne.uniteId,
    })) ?? []
  );
  const [etapes, setEtapes] = useState<EtapeRecetteInput[]>(
    recette?.etapes.map((etape) => ({
      description: etape.description,
      pointCritiqueHACCP: etape.pointCritiqueHACCP,
      controleHACCP: etape.controleHACCP,
    })) ?? []
  );

  const [categories, setCategories] = useState<CategorieRecette[]>([]);
  const [articles, setArticles] = useState<ArticleRecette[]>([]);
  const [unites, setUnites] = useState<UniteRecette[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/categories-recette`)
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
        // Pas de présélection : le champ de recherche reste vide pour écrire directement, plutôt
        // que de forcer à effacer le premier article de la liste avant de pouvoir taper.
        articleId: 0,
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

  function ajouterEtape() {
    setEtapes((precedent) => [
      ...precedent,
      { description: "", pointCritiqueHACCP: false, controleHACCP: null },
    ]);
  }

  function retirerEtape(index: number) {
    setEtapes((precedent) => precedent.filter((_, i) => i !== index));
  }

  function modifierEtape(index: number, changement: Partial<EtapeRecetteInput>) {
    setEtapes((precedent) =>
      precedent.map((etape, i) => (i === index ? { ...etape, ...changement } : etape))
    );
  }

  async function gererPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;

    try {
      const dataUrl = await redimensionnerImage(fichier);
      setPhoto(dataUrl);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Impossible de traiter cette photo");
    }
  }

  const coutTotal = useMemo(() => {
    return lignes.reduce((total, ligne) => {
      const article = articles.find((a) => a.id === ligne.articleId);
      const unite = unites.find((u) => u.id === ligne.uniteId);
      return total + estimerCoutLigne(article, ligne.quantite, unite);
    }, 0);
  }, [lignes, articles, unites]);

  const coutParPortion = portions > 0 ? coutTotal / portions : coutTotal;

  // Déduit les allergènes de la recette par union de ceux des ingrédients sélectionnés, plutôt
  // que de les faire ressaisir manuellement (qui pourrait diverger des ingrédients réellement
  // utilisés).
  const allergenes = useMemo(() => {
    const parId = new Map<number, string>();
    for (const ligne of lignes) {
      const article = articles.find((a) => a.id === ligne.articleId);
      for (const { allergene } of article?.allergenes ?? []) {
        parId.set(allergene.id, allergene.nom);
      }
    }
    return Array.from(parId, ([id, nom]) => ({ id, nom })).sort((a, b) =>
      a.nom.localeCompare(b.nom)
    );
  }, [lignes, articles]);

  async function enregistrer() {
    if (lignes.some((ligne) => !ligne.articleId)) {
      alert("Choisis un ingrédient pour chaque ligne (ou supprime les lignes vides).");
      return;
    }

    const payload = {
      nom,
      categorieId: categorieId || null,
      portions,
      prixVenteHT: prixVenteHT || null,
      instructions: instructions || null,
      photo,
      lignes,
      etapes,
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
        width: 700,
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "85vh",
        overflowY: "auto",
      }}
    >
      <h2>{recette ? "Modifier la recette" : "Nouvelle recette"}</h2>

      <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <label>Nom</label>
          <input
            type="text"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
          />
        </div>

        <div style={{ width: 160 }}>
          <label>Photo du plat</label>
          {photo ? (
            <div style={{ position: "relative" }}>
              <img
                src={photo}
                alt=""
                style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 6 }}
              />
              <button
                onClick={() => setPhoto(null)}
                style={{ position: "absolute", top: 4, right: 4 }}
              >
                ✕
              </button>
            </div>
          ) : (
            <input type="file" accept="image/*" onChange={gererPhoto} />
          )}
        </div>
      </div>

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
          <ChampNombre
            valeur={prixVenteHT}
            onChanger={(n) => setPrixVenteHT(n ?? 0)}
            style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
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
            <RechercheArticle
              articles={articles}
              articleId={ligne.articleId}
              onChange={(articleId) => modifierLigne(index, { articleId })}
            />

            <ChampNombre
              valeur={ligne.quantite}
              onChanger={(n) => modifierLigne(index, { quantite: n ?? 0 })}
              style={{ width: 90, padding: 8, boxSizing: "border-box" }}
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

      <button onClick={ajouterLigne} style={{ display: "block", marginBottom: 20 }}>
        + Ajouter un ingrédient
      </button>

      {allergenes.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <label>Allergènes (déduits des ingrédients)</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allergenes.map((allergene) => (
              <span
                key={allergene.id}
                style={{
                  background: "#fdecea",
                  color: "#b3261e",
                  borderRadius: 12,
                  padding: "4px 10px",
                  fontSize: 13,
                }}
              >
                {allergene.nom}
              </span>
            ))}
          </div>
        </div>
      )}

      <h3>Étapes de préparation et points de contrôle HACCP</h3>

      {etapes.map((etape, index) => (
        <div
          key={index}
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: 8,
            padding: 12,
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontWeight: "bold", paddingTop: 8 }}>{index + 1}.</span>
            <textarea
              value={etape.description}
              onChange={(e) => modifierEtape(index, { description: e.target.value })}
              placeholder="Description de l'étape (geste, technique à mettre en œuvre…)"
              rows={2}
              style={{ flex: 1, padding: 8, boxSizing: "border-box" }}
            />
            <button onClick={() => retirerEtape(index)}>✕</button>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={etape.pointCritiqueHACCP}
              onChange={(e) =>
                modifierEtape(index, {
                  pointCritiqueHACCP: e.target.checked,
                  controleHACCP: e.target.checked ? etape.controleHACCP : null,
                })
              }
            />
            Point critique HACCP
          </label>

          {etape.pointCritiqueHACCP && (
            <input
              type="text"
              value={etape.controleHACCP ?? ""}
              onChange={(e) => modifierEtape(index, { controleHACCP: e.target.value })}
              placeholder="Ex. Refroidissement à <10°C en moins de 2h, remise en température +3°C→+63°C en moins d'1h…"
              style={{
                width: "100%",
                padding: 8,
                marginTop: 8,
                boxSizing: "border-box",
                border: "1px solid #b3261e",
                borderRadius: 4,
              }}
            />
          )}
        </div>
      ))}

      <button onClick={ajouterEtape} style={{ display: "block", marginBottom: 20 }}>
        + Ajouter une étape
      </button>

      <label>Notes complémentaires</label>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={3}
        style={{ width: "100%", padding: 10, marginBottom: 20, boxSizing: "border-box" }}
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
