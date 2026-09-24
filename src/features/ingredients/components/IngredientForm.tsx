import toast from "react-hot-toast";
import { useEffect, useMemo, useState } from "react";
import { API_URL, apiFetch } from "../../../config/api";
import {
  creerIngredient,
  getAllergenes,
  getIngredients,
  modifierIngredient,
} from "../services/ingredientService";
import {
  trouverArticlesCorrespondants,
  type ArticleExistantPourCorrespondance,
} from "../utils/correspondanceArticle";
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

  // Articles actifs déjà en base, chargés uniquement en création (jamais en modification, voir
  // correspondances ci-dessous) : sert uniquement à repérer un doublon potentiel avant
  // d'enregistrer — le renommage d'un article existant reste hors périmètre de ce correctif.
  const [articlesExistants, setArticlesExistants] = useState<ArticleExistantPourCorrespondance[]>(
    []
  );
  // Couple (nom, référence) pour lequel l'utilisateur a explicitement confirmé vouloir créer un
  // doublon malgré l'avertissement — null si aucune confirmation en cours. Comparé au couple
  // actuel (confirmationDoublon ci-dessous) plutôt que d'être un simple booléen, pour qu'une
  // confirmation donnée ne valide jamais silencieusement la création d'un doublon différent après
  // modification du nom ou de la référence saisis.
  const [coupleConfirmeDoublon, setCoupleConfirmeDoublon] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`${API_URL}/categories`)
      .then((response) => response.json())
      .then((data) => {
        setCategories(data);
        if (!ingredient && data.length > 0) setCategorieId(data[0].id);
      });

    apiFetch(`${API_URL}/unites`)
      .then((response) => response.json())
      .then((data) => {
        setUnites(data);
        if (!ingredient && data.length > 0) setUniteId(data[0].id);
      });

    getAllergenes().then(setAllergenes);

    // Uniquement en création : modifier un article existant ne crée jamais de doublon par
    // lui-même (voir le commentaire d'articlesExistants ci-dessus).
    if (!ingredient) {
      // getIngredients() ne renvoie que les articles actifs (voir GET /articles) : un article
      // inactif du même nom ne bloque donc jamais une nouvelle création, par construction — en
      // plus du filtre actif déjà appliqué dans trouverArticlesCorrespondants lui-même.
      getIngredients().then((data) =>
        setArticlesExistants(
          data.map((a) => ({ id: a.id, nom: a.nom, reference: a.reference ?? null, actif: true }))
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Articles déjà en base correspondant au nom/à la référence en cours de saisie (voir
  // trouverArticlesCorrespondants, correspondanceArticle.ts) — jamais calculé en modification,
  // pour ne jamais bloquer l'enregistrement d'un article existant sur son propre nom.
  const correspondances = useMemo(
    () => (ingredient ? [] : trouverArticlesCorrespondants(nom, reference, articlesExistants)),
    [ingredient, nom, reference, articlesExistants]
  );
  const confirmationDoublon = coupleConfirmeDoublon === `${nom}\u0000${reference}`;

  function basculerAllergene(id: number) {
    setAllergeneIds((precedent) =>
      precedent.includes(id) ? precedent.filter((a) => a !== id) : [...precedent, id]
    );
  }

  async function enregistrer() {
    // Doublon détecté (nom ou référence déjà en base) et non confirmé explicitement : bloque
    // l'enregistrement, même principe que le correctif déjà appliqué à la création de recette
    // (RecetteForm.tsx) — jamais de création silencieuse d'un article déjà existant.
    if (correspondances.length > 0 && !confirmationDoublon) {
      toast.error(
        "Un article portant ce nom ou cette référence existe déjà : coche la confirmation pour créer quand même ce doublon."
      );
      return;
    }

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
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
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

      {correspondances.length > 0 && (
        <div
          style={{
            background: "#fff4e5",
            border: "1px solid #f0b429",
            borderRadius: 6,
            padding: "8px 10px",
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          <strong>⚠ Doublon potentiel</strong>
          <div style={{ marginTop: 4 }}>
            Un article correspondant existe déjà :{" "}
            {correspondances.map((c) => `« ${c.nom} »`).join(", ")}. Enregistrer créera un article
            supplémentaire, distinct de {correspondances.length > 1 ? "ceux-ci" : "celui-ci"}.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={confirmationDoublon}
              onChange={(e) =>
                setCoupleConfirmeDoublon(e.target.checked ? `${nom}\u0000${reference}` : null)
              }
            />
            Je confirme vouloir créer cet article malgré le doublon détecté
          </label>
        </div>
      )}

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
        <button className="btn-primary" onClick={enregistrer}>Enregistrer</button>
      </div>
    </div>
  );
}
