import toast from "react-hot-toast";
import { useEffect, useMemo, useState } from "react";
import { API_URL, apiFetch } from "../../../config/api";
import ChampNombre from "../../../common/ChampNombre";
import { redimensionnerImage } from "../../../common/redimensionnerImage";
import {
  creerRecette,
  enregistrerAliasIngredients,
  getArticlesDisponibles,
  getUnitesDisponibles,
  modifierRecette,
} from "../services/recetteService";
import { estimerCoutLigne } from "../utils/cout";
import { definirFiltrerSuperU, estFournisseurSuperU, filtrerSuperUActif } from "../utils/filtreFournisseur";
import { trouverUniteParDefaut } from "../utils/uniteParDefaut";
import ImporterTechniquesModal from "./ImporterTechniquesModal";
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

// Pré-remplissage optionnel utilisé uniquement à la création (ex. depuis l'import de recette par
// IA) : contrairement à `recette`, sa présence ne déclenche jamais une modification (PUT) plutôt
// qu'une création (POST) — voir enregistrer().
type BrouillonRecette = {
  nom?: string;
  portions?: number;
  lignes?: LigneRecetteInput[];
  etapes?: EtapeRecetteInput[];
};

type Props = {
  recette: Recette | null;
  brouillon?: BrouillonRecette;
  onClose: () => void;
  onSave: () => void;
};

export default function RecetteForm({ recette, brouillon, onClose, onSave }: Props) {
  const [nom, setNom] = useState(recette?.nom ?? brouillon?.nom ?? "");
  const [categorieId, setCategorieId] = useState<number>(recette?.categorieId ?? 0);
  const [portions, setPortions] = useState(recette?.portions ?? brouillon?.portions ?? 1);
  const [poidsPortionG, setPoidsPortionG] = useState(recette?.poidsPortionG ?? 0);
  const [poidsAccompagnementG, setPoidsAccompagnementG] = useState(
    recette?.poidsAccompagnementG ?? 0
  );
  const [modeQuantite, setModeQuantite] = useState<"portions" | "poids">("portions");
  // Valeur brute du champ "poids total (kg)", indépendante de portions : liée directement à
  // portions (arrondi à l'entier), elle se corromprait à chaque frappe (le champ se resynchronise
  // à chaque changement de portions, donc sur une valeur arrondie différente de ce qui vient
  // d'être tapé).
  const [poidsTotalKgSaisi, setPoidsTotalKgSaisi] = useState(() =>
    recette?.poidsPortionG ? (recette.portions * recette.poidsPortionG) / 1000 : 0
  );
  const [prixVenteHT, setPrixVenteHT] = useState(recette?.prixVenteHT ?? 0);
  const [instructions, setInstructions] = useState(recette?.instructions ?? "");
  const [photo, setPhoto] = useState<string | null>(recette?.photo ?? null);
  const [lignes, setLignes] = useState<LigneRecetteInput[]>(
    recette?.lignes.map((ligne) => ({
      articleId: ligne.articleId,
      quantite: ligne.quantite,
      uniteId: ligne.uniteId,
      gainCuissonPct: ligne.gainCuissonPct,
    })) ??
      brouillon?.lignes ??
      []
  );
  const [etapes, setEtapes] = useState<EtapeRecetteInput[]>(
    recette?.etapes.map((etape) => ({
      description: etape.description,
      pointCritiqueHACCP: etape.pointCritiqueHACCP,
      controleHACCP: etape.controleHACCP,
    })) ?? brouillon?.etapes ?? []
  );

  const [categories, setCategories] = useState<CategorieRecette[]>([]);
  const [articles, setArticles] = useState<ArticleRecette[]>([]);
  const [unites, setUnites] = useState<UniteRecette[]>([]);
  const [importTechniquesOuvert, setImportTechniquesOuvert] = useState(false);
  // Restreint la recherche d'ingrédient aux articles fournis par Super U par défaut (voir
  // filtreFournisseur.ts) ; mémorisé pour ne pas avoir à le redéfinir à chaque recette.
  const [filtrerSuperU, setFiltrerSuperU] = useState(filtrerSuperUActif);

  function changerFiltrerSuperU(valeur: boolean) {
    setFiltrerSuperU(valeur);
    definirFiltrerSuperU(valeur);
  }

  useEffect(() => {
    apiFetch(`${API_URL}/categories-recette`)
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
        uniteId: trouverUniteParDefaut(unites)?.id ?? 0,
        gainCuissonPct: 0,
      },
    ]);
  }

  // Poids total (kg) équivalent au nombre de portions actuel, pour l'indication sous le champ —
  // toujours dérivé de portions (la valeur qui fait foi), contrairement au champ de saisie en kg
  // lui-même (poidsTotalKgSaisi) qui doit rester libre pendant la frappe.
  const poidsTotalKg = poidsPortionG > 0 ? (portions * poidsPortionG) / 1000 : 0;

  function changerPoidsTotalKg(kg: number) {
    setPoidsTotalKgSaisi(kg);
    if (poidsPortionG > 0) {
      setPortions(Math.max(1, Math.round((kg * 1000) / poidsPortionG)));
    }
  }

  function passerEnModeKg() {
    if (poidsPortionG <= 0) {
      toast.error(
        "Renseigne d'abord le poids d'une portion (en grammes, ci-dessous) pour pouvoir saisir la quantité à produire en kg."
      );
      return;
    }
    setPoidsTotalKgSaisi((portions * poidsPortionG) / 1000);
    setModeQuantite("poids");
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
      toast.error(error instanceof Error ? error.message : "Impossible de traiter cette photo");
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
      toast.error("Choisis un ingrédient pour chaque ligne (ou supprime les lignes vides).");
      return;
    }

    const payload = {
      nom,
      categorieId: categorieId || null,
      portions,
      poidsPortionG: poidsPortionG || null,
      poidsAccompagnementG: poidsAccompagnementG || null,
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

      // Mémorise les choix d'article faits sur des lignes issues d'un import texte/photo (voir
      // ImporterRecetteModal.tsx), pour que le prochain import retrouve directement le bon
      // article. Ne bloque jamais l'enregistrement de la recette, déjà acquis à ce stade.
      const correspondances = lignes
        .filter((ligne) => ligne.texteIngredientImporte && ligne.articleId)
        .map((ligne) => ({ texte: ligne.texteIngredientImporte!, articleId: ligne.articleId }));
      enregistrerAliasIngredients(correspondances);

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

        <div style={{ width: 180 }}>
          <label>Quantité à produire</label>
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <button
              type="button"
              onClick={() => setModeQuantite("portions")}
              style={{
                flex: 1,
                padding: 8,
                border: "1px solid #16a085",
                borderRadius: 4,
                cursor: "pointer",
                background: modeQuantite === "portions" ? "#16a085" : "white",
                color: modeQuantite === "portions" ? "white" : "#16a085",
              }}
            >
              Portions
            </button>
            <button
              type="button"
              onClick={passerEnModeKg}
              style={{
                flex: 1,
                padding: 8,
                border: "1px solid #16a085",
                borderRadius: 4,
                cursor: "pointer",
                background: modeQuantite === "poids" ? "#16a085" : "white",
                color: modeQuantite === "poids" ? "white" : poidsPortionG > 0 ? "#16a085" : "#aaa",
              }}
            >
              Kg
            </button>
          </div>
          {modeQuantite === "portions" ? (
            <input
              type="number"
              min={1}
              value={portions}
              onChange={(e) => setPortions(Number(e.target.value))}
              style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
            />
          ) : (
            <ChampNombre
              valeur={poidsTotalKgSaisi}
              onChanger={(n) => changerPoidsTotalKg(n ?? 0)}
              style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
            />
          )}
          {poidsPortionG > 0 && (
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
              {portions} portion{portions > 1 ? "s" : ""} ≈ {poidsTotalKg.toFixed(2)} kg
            </div>
          )}
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

      <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
        <div style={{ width: 200 }}>
          <label>Poids d'une portion (g)</label>
          <ChampNombre
            valeur={poidsPortionG}
            onChanger={(n) => setPoidsPortionG(n ?? 0)}
            style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
            placeholder="ex. 350"
          />
        </div>

        <div style={{ width: 200 }}>
          <label>dont accompagnement (g)</label>
          <ChampNombre
            valeur={poidsAccompagnementG}
            onChanger={(n) => setPoidsAccompagnementG(n ?? 0)}
            style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
            placeholder="ex. 130"
          />
        </div>
      </div>

      <h3>Ingrédients</h3>
      <p style={{ fontSize: 12, color: "#888", marginTop: -8, marginBottom: 12 }}>
        « Gain % » : poids gagné à la cuisson pour cet ingrédient (ex. eau ou sauce absorbée),
        en plus de son rendement — sert au calcul de production (voir la fiche de la recette).
      </p>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={filtrerSuperU}
          onChange={(e) => changerFiltrerSuperU(e.target.checked)}
        />
        <span style={{ fontSize: 13, color: "#555" }}>
          Ne proposer que les articles fournis par Super U dans la recherche d'ingrédient
        </span>
      </label>

      {lignes.map((ligne, index) => {
        const article = articles.find((a) => a.id === ligne.articleId);
        const unite = unites.find((u) => u.id === ligne.uniteId);
        const cout = estimerCoutLigne(article, ligne.quantite, unite);
        // L'article déjà sélectionné pour cette ligne reste toujours proposé même s'il ne
        // correspond pas au filtre, pour ne pas faire disparaître le nom déjà choisi (voir
        // RechercheArticle.tsx, qui résout l'affichage depuis la liste reçue).
        const articlesPourLigne = filtrerSuperU
          ? articles.filter((a) => estFournisseurSuperU(a) || a.id === ligne.articleId)
          : articles;

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
              articles={articlesPourLigne}
              articlesRepli={filtrerSuperU ? articles : undefined}
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

            <ChampNombre
              valeur={ligne.gainCuissonPct}
              onChanger={(n) => modifierLigne(index, { gainCuissonPct: n ?? 0 })}
              style={{ width: 70, padding: 8, boxSizing: "border-box" }}
              placeholder="Gain %"
            />

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

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button onClick={ajouterEtape}>+ Ajouter une étape</button>
        <button onClick={() => setImportTechniquesOuvert(true)}>Importer des techniques</button>
      </div>

      {importTechniquesOuvert && (
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
            zIndex: 20,
          }}
        >
          <ImporterTechniquesModal
            onClose={() => setImportTechniquesOuvert(false)}
            onEtapesExtraites={(nouvelles) => setEtapes((precedent) => [...precedent, ...nouvelles])}
          />
        </div>
      )}

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
        <button className="btn-primary" onClick={enregistrer}>Enregistrer</button>
      </div>
    </div>
  );
}
