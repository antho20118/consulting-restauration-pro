import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import RecettesGrille from "../components/RecettesGrille";
import RecetteForm from "../components/RecetteForm";
import RecetteDetail from "../components/RecetteDetail";
import ImporterRecetteModal from "../components/ImporterRecetteModal";
import ImporterFichierCoutsModal from "../components/ImporterFichierCoutsModal";
import ImporterTechniquesFichierModal from "../components/ImporterTechniquesFichierModal";
import ImporterRecettesExcelSecuriseModal from "../components/ImporterRecettesExcelSecuriseModal";
import { API_URL, apiFetch } from "../../../config/api";
import toast from "react-hot-toast";
import { getRecettes, supprimerRecette, supprimerToutesLesRecettes } from "../services/recetteService";
import { exporterExcel } from "../../../common/exportExcel";
import { normaliserTexte } from "../utils/normaliserTexte";
import type { BrouillonRecette, Recette } from "../types/recette";

type SousCategorieRecette = {
  id: number;
  nom: string;
  parentId: number | null;
};

// Les 5 catégories principales reconnues par les onglets de la page d'accueil, par leur nom
// normalisé (accents/casse ignorés) — l'onglet "Autres" attrape tout le reste (catégorie
// personnalisée, Festif, Mariage, ou aucune catégorie) : jamais une recette invisible faute de
// catégorie connue.
const ONGLETS_CATEGORIE = [
  { cle: "tout", label: "Tout" },
  { cle: "entree", label: "Entrées" },
  { cle: "plat", label: "Plats" },
  { cle: "sauces", label: "Sauces" },
  { cle: "accompagnement", label: "Accompagnements" },
  { cle: "dessert", label: "Desserts" },
  { cle: "autres", label: "Autres" },
] as const;
type CleOngletCategorie = (typeof ONGLETS_CATEGORIE)[number]["cle"];
const CLES_CATEGORIES_CONNUES = ["entree", "plat", "accompagnement", "sauces", "dessert"];

// Résout la clé d'onglet d'une recette à partir du nom de sa catégorie (accents/casse ignorés) :
// une recette dont la catégorie ne correspond à aucun des 4 onglets connus (catégorie
// personnalisée, "Festif", "Mariage", ou aucune catégorie du tout) tombe dans "autres" plutôt
// que de disparaître silencieusement d'un onglet.
function ongletDeLaRecette(recette: Recette): CleOngletCategorie {
  const nom = recette.categorie?.nom ? normaliserTexte(recette.categorie.nom) : "";
  return CLES_CATEGORIES_CONNUES.includes(nom) ? (nom as CleOngletCategorie) : "autres";
}

export default function RecettesPage() {
  const [recettes, setRecettes] = useState<Recette[]>([]);
  const [recetteEnEdition, setRecetteEnEdition] = useState<Recette | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [brouillonImport, setBrouillonImport] = useState<BrouillonRecette | undefined>(undefined);
  const [importOuvert, setImportOuvert] = useState(false);
  const [importFichierCoutsOuvert, setImportFichierCoutsOuvert] = useState(false);
  const [importTechniquesFichierOuvert, setImportTechniquesFichierOuvert] = useState(false);
  const [importExcelSecuriseOuvert, setImportExcelSecuriseOuvert] = useState(false);
  const [recetteConsultee, setRecetteConsultee] = useState<Recette | null>(null);
  const [recherche, setRecherche] = useState("");
  const [sousCategories, setSousCategories] = useState<SousCategorieRecette[]>([]);
  const [filtreSousCategorieId, setFiltreSousCategorieId] = useState(0);
  const [ongletCategorie, setOngletCategorie] = useState<CleOngletCategorie>("tout");

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

  const comptesParOnglet = useMemo(() => {
    const comptes: Record<CleOngletCategorie, number> = {
      tout: recettes.length,
      entree: 0,
      plat: 0,
      accompagnement: 0,
      sauces: 0,
      dessert: 0,
      autres: 0,
    };
    recettes.forEach((recette) => {
      comptes[ongletDeLaRecette(recette)]++;
    });
    return comptes;
  }, [recettes]);

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
      if (ongletCategorie !== "tout" && ongletDeLaRecette(recette) !== ongletCategorie) {
        return false;
      }
      return true;
    });
  }, [recettes, recherche, idsSousCategorieFiltre, ongletCategorie]);

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

  // Action rarement utilisée et irréversible pour l'utilisateur (même si les données restent
  // techniquement en base, "supprimée" en pratique) : un simple confirm() serait trop facile à
  // valider par réflexe vu le nombre de recettes concernées, on demande de taper un mot précis.
  async function supprimerTout() {
    const saisie = prompt(
      `Supprimer les ${recettes.length} recette(s) ? Cette action est irréversible depuis l'application.\n\nTape SUPPRIMER pour confirmer.`
    );
    if (saisie !== "SUPPRIMER") return;

    const supprimees = await supprimerToutesLesRecettes();
    toast.success(`${supprimees} recette(s) supprimée(s).`);
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

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {ONGLETS_CATEGORIE.map((onglet) => (
          <button
            key={onglet.cle}
            onClick={() => setOngletCategorie(onglet.cle)}
            style={{
              padding: "8px 14px",
              borderRadius: 20,
              border: "1px solid var(--couleur-bordure)",
              background: ongletCategorie === onglet.cle ? "var(--couleur-primaire)" : "transparent",
              color: ongletCategorie === onglet.cle ? "white" : "inherit",
              cursor: "pointer",
              fontWeight: ongletCategorie === onglet.cle ? 600 : 400,
            }}
          >
            {onglet.label} ({comptesParOnglet[onglet.cle]})
          </button>
        ))}
      </div>

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
          <button onClick={() => setImportFichierCoutsOuvert(true)}>Importer un fichier de coûts</button>
          <button onClick={() => setImportTechniquesFichierOuvert(true)}>Importer des techniques (fichier)</button>
          <button onClick={() => setImportExcelSecuriseOuvert(true)}>Importer Excel (sécurisé)</button>
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

      {recettes.length > 0 && (
        <div style={{ textAlign: "right", marginBottom: 10 }}>
          <button
            onClick={supprimerTout}
            style={{ fontSize: 12, color: "#b00020", background: "none", border: "none", cursor: "pointer" }}
          >
            Supprimer toutes les recettes ({recettes.length})
          </button>
        </div>
      )}

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
            onCree={(brouillon) => {
              setImportOuvert(false);
              setRecetteEnEdition(null);
              setBrouillonImport(brouillon);
              setFormulaireOuvert(true);
            }}
          />
        </div>
      )}

      {importFichierCoutsOuvert && (
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
          <ImporterFichierCoutsModal
            onClose={() => setImportFichierCoutsOuvert(false)}
            onImporte={chargerRecettes}
          />
        </div>
      )}

      {importTechniquesFichierOuvert && (
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
          <ImporterTechniquesFichierModal
            onClose={() => setImportTechniquesFichierOuvert(false)}
            onImporte={chargerRecettes}
          />
        </div>
      )}

      {importExcelSecuriseOuvert && (
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
          <ImporterRecettesExcelSecuriseModal
            onClose={() => setImportExcelSecuriseOuvert(false)}
            onImporte={chargerRecettes}
          />
        </div>
      )}

      {recetteConsultee &&
        createPortal(
          // Rendu directement sous <body> (pas sous .app-layout) : à l'impression, le CSS de
          // RecetteDetail masque tout ce qui n'est pas ce pop-up (voir body.fiche-technique-ouverte),
          // ce qui exige que ce pop-up soit un enfant direct de <body>, pas un descendant de la
          // barre latérale/liste des recettes qu'on cherche justement à masquer.
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
          </div>,
          document.body
        )}
    </div>
  );
}
