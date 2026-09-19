import { useEffect, useMemo, useState } from "react";
import RecettesGrille from "../components/RecettesGrille";
import RecetteForm from "../components/RecetteForm";
import RecetteDetail from "../components/RecetteDetail";
import ImporterRecetteModal from "../components/ImporterRecetteModal";
import { API_URL, apiFetch } from "../../../config/api";
import { getRecettes, supprimerRecette } from "../services/recetteService";
import { exporterExcel } from "../../../common/exportExcel";
import { normaliserTexte } from "../utils/normaliserTexte";
import type { LigneRecetteInput, Recette } from "../types/recette";

type SousCategorieRecette = {
  id: number;
  nom: string;
  parentId: number | null;
};

type BrouillonImport = {
  nom?: string;
  portions?: number;
  lignes: LigneRecetteInput[];
  etapes: { description: string; pointCritiqueHACCP: boolean; controleHACCP: string | null }[];
};

export default function RecettesPage() {
  const [recettes, setRecettes] = useState<Recette[]>([]);
  const [recetteEnEdition, setRecetteEnEdition] = useState<Recette | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [brouillonImport, setBrouillonImport] = useState<BrouillonImport | undefined>(undefined);
  const [importOuvert, setImportOuvert] = useState(false);
  const [recetteConsultee, setRecetteConsultee] = useState<Recette | null>(null);
  const [recherche, setRecherche] = useState("");
  const [sousCategories, setSousCategories] = useState<SousCategorieRecette[]>([]);
  const [filtreSousCategorieId, setFiltreSousCategorieId] = useState(0);

  async function chargerRecettes() {
    const data = await getRecettes();
    setRecettes(data);
  }

  useEffect(() => {
    getRecettes().then(setRecettes);
    apiFetch(`${API_URL}/sous-categories-recette`)
      .then((r) => r.json())
      .then(setSousCategories);
  }, []);

  // Liste plate pour le menu déroulant : racines dans l'ordre, chacune suivie de ses enfants
  // (indentés) juste après, plutôt que toutes les sous-catégories mélangées par ordre alphabétique.
  const sousCategoriesOrdonnees = useMemo(() => {
    const liste: { id: number; nom: string; indent: boolean }[] = [];
    for (const racine of sousCategories.filter((sc) => sc.parentId === null)) {
      liste.push({ id: racine.id, nom: racine.nom, indent: false });
      for (const enfant of sousCategories.filter((sc) => sc.parentId === racine.id)) {
        liste.push({ id: enfant.id, nom: enfant.nom, indent: true });
      }
    }
    return liste;
  }, [sousCategories]);

  // Filtrer sur une sous-catégorie racine (ex. Viande) inclut aussi ses enfants (Bœuf, Veau...) :
  // sinon choisir "Viande" dans le filtre ne montrerait que les recettes non précisées.
  const idsSousCategorieFiltre = useMemo(() => {
    if (!filtreSousCategorieId) return null;
    const ids = new Set([filtreSousCategorieId]);
    for (const sc of sousCategories) {
      if (sc.parentId === filtreSousCategorieId) ids.add(sc.id);
    }
    return ids;
  }, [filtreSousCategorieId, sousCategories]);

  const recettesFiltrees = useMemo(() => {
    const terme = normaliserTexte(recherche);
    return recettes.filter((recette) => {
      if (terme) {
        // Cherche aussi dans les ingrédients de la recette, pas seulement son nom : "saumon" doit
        // retrouver une recette qui en contient sans que ce soit dans son titre.
        const correspondNom = normaliserTexte(recette.nom).includes(terme);
        const correspondIngredient = recette.lignes.some((ligne) =>
          normaliserTexte(ligne.article.nom).includes(terme)
        );
        if (!correspondNom && !correspondIngredient) return false;
      }
      if (idsSousCategorieFiltre && !idsSousCategorieFiltre.has(recette.sousCategorieId ?? -1)) {
        return false;
      }
      return true;
    });
  }, [recettes, recherche, idsSousCategorieFiltre]);

  function ouvrirCreation() {
    setRecetteEnEdition(null);
    setBrouillonImport(undefined);
    setFormulaireOuvert(true);
  }

  function fermerFormulaire() {
    setFormulaireOuvert(false);
    setBrouillonImport(undefined);
  }

  function ouvrirEdition(recette: Recette) {
    setRecetteConsultee(null);
    setRecetteEnEdition(recette);
    setFormulaireOuvert(true);
  }

  async function supprimer(recette: Recette) {
    if (!confirm(`Supprimer la recette "${recette.nom}" ?`)) return;
    await supprimerRecette(recette.id);
    setRecetteConsultee(null);
    chargerRecettes();
  }

  async function exporter() {
    await exporterExcel(`recettes_${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        nom: "Recettes",
        lignes: recettesFiltrees.map((recette) => ({
          Nom: recette.nom,
          Catégorie: recette.categorie?.nom ?? "",
          "Sous-catégorie": recette.sousCategorie?.nom ?? "",
          Portions: recette.portions,
          "Coût total (€)": Number(recette.coutTotal.toFixed(2)),
          "Coût / portion (€)": Number(recette.coutParPortion.toFixed(2)),
          "Prix de vente HT (€)": recette.prixVenteHT ?? "",
          "Food cost (%)": recette.foodCostPct != null ? Number(recette.foodCostPct.toFixed(1)) : "",
          "Marge HT (€)": recette.margeHT != null ? Number(recette.margeHT.toFixed(2)) : "",
        })),
      },
      {
        nom: "Ingrédients par recette",
        lignes: recettesFiltrees.flatMap((recette) =>
          recette.lignes.map((ligne) => ({
            Recette: recette.nom,
            Ingrédient: ligne.article.nom,
            Quantité: ligne.quantite,
            Unité: ligne.unite.symbole,
            "Coût ligne (€)": Number(ligne.coutLigne.toFixed(2)),
          }))
        ),
      },
    ]);
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>📖 Fiches recettes</h1>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={ouvrirCreation}>+ Nouvelle recette</button>
          <button onClick={() => setImportOuvert(true)}>Importer une recette</button>
          <button onClick={exporter}>Exporter Excel</button>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <select
            value={filtreSousCategorieId}
            onChange={(e) => setFiltreSousCategorieId(Number(e.target.value))}
            style={{ padding: 8 }}
          >
            <option value={0}>Toutes les sous-catégories</option>
            {sousCategoriesOrdonnees.map((sousCategorie) => (
              <option key={sousCategorie.id} value={sousCategorie.id}>
                {sousCategorie.indent ? `-- ${sousCategorie.nom}` : sousCategorie.nom}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Rechercher..."
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            style={{ width: 300, padding: 8 }}
          />
        </div>
      </div>

      <RecettesGrille recettes={recettesFiltrees} onOuvrir={setRecetteConsultee} />

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
          <RecetteForm
            recette={recetteEnEdition}
            brouillon={brouillonImport}
            onClose={fermerFormulaire}
            onSave={chargerRecettes}
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
          <ImporterRecetteModal
            onClose={() => setImportOuvert(false)}
            onExtrait={(brouillon) => {
              setImportOuvert(false);
              setRecetteEnEdition(null);
              setBrouillonImport(brouillon);
              setFormulaireOuvert(true);
            }}
          />
        </div>
      )}

      {recetteConsultee && (
        <div
          className="fiche-technique-apercu-overlay"
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
          <RecetteDetail
            recette={recetteConsultee}
            onClose={() => setRecetteConsultee(null)}
            onEdit={ouvrirEdition}
            onDelete={supprimer}
          />
        </div>
      )}
    </div>
  );
}
