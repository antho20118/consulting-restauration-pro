import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import toast from "react-hot-toast";
import { redimensionnerImage } from "../../../common/redimensionnerImage";
import {
  ErreurImportIA,
  getAliasIngredients,
  getArticlesDisponibles,
  getCategoriesRecette,
  getRecettes,
  getSousCategoriesRecette,
  getUnitesDisponibles,
  importerRecetteIA,
  modifierRecette,
} from "../services/recetteService";
import { analyseRecetteLocale } from "../utils/analyseRecetteLocale";
import { estFournisseurSuperU, filtrerSuperUActif } from "../utils/filtreFournisseur";
import { construireLigneImportee, construireMaterielImporte, materielVersLigne } from "../utils/ligneImportee";
import { normaliserExtraction } from "../utils/normaliserExtraction";
import { extraireTexteDePhoto } from "../utils/ocrPhoto";
import {
  analyserFichierTechniques,
  trouverRecetteCorrespondante,
  type RecetteTechniqueExtraite,
} from "../utils/analyserFichierTechniques";
import PrevisualisationImportRecette from "./PrevisualisationImportRecette";
import type {
  AliasIngredient,
  ArticleRecette,
  ExtractionRecette,
  LigneRecetteInput,
  PatchImportRecette,
  Recette,
  UniteRecette,
} from "../types/recette";

type Props = {
  onClose: () => void;
  onImporte: () => void;
};

type StatutRecette = "attente" | "en_cours" | "ajoutee" | "erreur";

type CategorieOption = { id: number; nom: string };
type SousCategorieOption = { id: number; nom: string; parentId: number | null };

// Complète une ou plusieurs recettes existantes par leurs techniques (étapes), sans jamais créer
// de recette ni toucher aux autres champs métier (ingrédients, HACCP déjà en place, notes,
// photo...) — deux sources possibles pour ces techniques, choisies via le sélecteur en tête de
// modale :
//   - Fichier : plusieurs fiches à la fois (une feuille par recette), rapprochées par titre ;
//   - Photo : une seule fiche technique photographiée (galerie ou caméra), la recette cible étant
//     choisie explicitement (une photo, contrairement à un classeur, ne porte pas de nom de feuille
//     exploitable pour un rapprochement automatique) — réutilise le même moteur d'analyse et la
//     même prévisualisation modifiable que l'import depuis une recette déjà ouverte (voir
//     ImporterRecetteModal.tsx / PrevisualisationImportRecette.tsx), jamais un second mécanisme.
export default function ImporterTechniquesFichierModal({ onClose, onImporte }: Props) {
  const [mode, setMode] = useState<"fichier" | "photo">("fichier");
  const [recettesToutes, setRecettesToutes] = useState<Recette[]>([]);

  useEffect(() => {
    getRecettes().then(setRecettesToutes);
  }, []);

  // --- Mode fichier (inchangé) ---
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  const [recettesTechniques, setRecettesTechniques] = useState<RecetteTechniqueExtraite[]>([]);
  const [correspondanceChoisie, setCorrespondanceChoisie] = useState<Record<number, number>>({});
  const [statuts, setStatuts] = useState<Record<number, StatutRecette>>({});

  async function gererFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;

    setChargement(true);
    setErreur("");
    try {
      const [recettesExtraites, recettesData] = await Promise.all([
        analyserFichierTechniques(fichier),
        getRecettes(),
      ]);

      if (recettesExtraites.length === 0) {
        setErreur("Aucune recette reconnue dans ce fichier.");
        setChargement(false);
        return;
      }

      setRecettesTechniques(recettesExtraites);
      setRecettesToutes(recettesData);

      const initCorrespondance: Record<number, number> = {};
      recettesExtraites.forEach((recette, index) => {
        const correspondance = trouverRecetteCorrespondante(recette.titre, recettesData);
        initCorrespondance[index] = correspondance?.id ?? 0;
      });
      setCorrespondanceChoisie(initCorrespondance);
    } catch {
      setErreur("Impossible de lire ce fichier. Formats acceptés : .xlsx, .xls, .ods");
    } finally {
      setChargement(false);
    }
  }

  async function appliquer(index: number) {
    const recetteTechnique = recettesTechniques[index];
    const recetteId = correspondanceChoisie[index];
    const existante = recettesToutes.find((r) => r.id === recetteId);
    if (!existante) return;

    setStatuts((s) => ({ ...s, [index]: "en_cours" }));
    try {
      await modifierRecette(recetteId, {
        nom: existante.nom,
        categorieId: existante.categorieId,
        sousCategorieId: existante.sousCategorieId,
        portions: existante.portions,
        poidsPortionG: existante.poidsPortionG,
        poidsAccompagnementG: existante.poidsAccompagnementG,
        prixVenteHT: existante.prixVenteHT,
        instructions: existante.instructions,
        photo: existante.photo,
        lignes: existante.lignes.map((l) => ({
          articleId: l.articleId,
          // Lignes d'une recette déjà enregistrée, reprises telles quelles (seules les étapes
          // sont modifiées par cet import) — déjà validées, comme dans RecetteForm.tsx.
          articleConfirme: true,
          quantite: l.quantite,
          uniteId: l.uniteId,
          gainCuissonPct: l.gainCuissonPct,
        })),
        etapes: [
          ...existante.etapes.map((e) => ({
            description: e.description,
            pointCritiqueHACCP: e.pointCritiqueHACCP,
            controleHACCP: e.controleHACCP,
          })),
          ...recetteTechnique.etapes,
        ],
      });
      setStatuts((s) => ({ ...s, [index]: "ajoutee" }));
      onImporte();
    } catch {
      setStatuts((s) => ({ ...s, [index]: "erreur" }));
      toast.error(`Échec de l'ajout des étapes à "${existante.nom}"`);
    }
  }

  async function appliquerTout() {
    const indexApplicables = recettesTechniques
      .map((_r, i) => i)
      .filter((i) => correspondanceChoisie[i] && statuts[i] !== "ajoutee");
    for (const index of indexApplicables) {
      await appliquer(index);
    }
    toast.success(`Étapes ajoutées à ${indexApplicables.length} recette(s).`);
  }

  const nbApplicables = recettesTechniques.filter(
    (_r, i) => correspondanceChoisie[i] && statuts[i] !== "ajoutee"
  ).length;

  // --- Mode photo ---
  const [recetteCibleId, setRecetteCibleId] = useState(0);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [enCoursPhoto, setEnCoursPhoto] = useState(false);
  const [extractionPhoto, setExtractionPhoto] = useState<ExtractionRecette | null>(null);
  const [lignesIngredientsPhoto, setLignesIngredientsPhoto] = useState<LigneRecetteInput[]>([]);
  const [lignesMaterielPhoto, setLignesMaterielPhoto] = useState<LigneRecetteInput[]>([]);
  const [articlesPhoto, setArticlesPhoto] = useState<ArticleRecette[]>([]);
  const [unitesPhoto, setUnitesPhoto] = useState<UniteRecette[]>([]);
  const [categoriesPhoto, setCategoriesPhoto] = useState<CategorieOption[]>([]);
  const [sousCategoriesPhoto, setSousCategoriesPhoto] = useState<SousCategorieOption[]>([]);

  async function choisirPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    try {
      setPhotoDataUrl(await redimensionnerImage(fichier, 1600));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de traiter cette photo");
    }
  }

  async function analyserPhoto() {
    if (!photoDataUrl) return;

    setEnCoursPhoto(true);
    try {
      let extractionRecue: ExtractionRecette;
      try {
        extractionRecue = await importerRecetteIA({ photoDataUrl });
      } catch (error) {
        if (!(error instanceof ErreurImportIA) || error.status !== 503) throw error;
        // IA non configurée : même repli gratuit (OCR + analyse par règles) que
        // ImporterRecetteModal.tsx, moins fiable mais toujours exploitable.
        toast("IA non configurée : analyse locale utilisée (moins précise, à vérifier).", { icon: "ℹ️" });
        extractionRecue = analyseRecetteLocale(await extraireTexteDePhoto(photoDataUrl));
      }

      // Couche déterministe commune aux deux moteurs (voir normaliserExtraction.ts) : ne réinterprète
      // jamais le sens d'une donnée, corrige uniquement des défauts de forme (ponctuation résiduelle,
      // doublons, numérotation des étapes).
      extractionRecue = normaliserExtraction(extractionRecue);

      if (
        extractionRecue.ingredients.length === 0 &&
        extractionRecue.etapes.length === 0 &&
        extractionRecue.materiel.length === 0
      ) {
        toast.error("Rien d'exploitable n'a été reconnu dans cette photo.");
        return;
      }

      const [articlesTous, unitesData, alias, categoriesData, sousCategoriesData] = await Promise.all([
        getArticlesDisponibles(),
        getUnitesDisponibles(),
        getAliasIngredients(),
        getCategoriesRecette(),
        getSousCategoriesRecette(),
      ]);
      const aliasParTexte = new Map(alias.map((a: AliasIngredient) => [a.texteNormalise, a.articleId]));
      const articlesFiltres = filtrerSuperUActif()
        ? articlesTous.filter((a) => estFournisseurSuperU(a))
        : articlesTous;

      const lignesIngr = extractionRecue.ingredients.map((ingredient) =>
        construireLigneImportee(ingredient, articlesFiltres, unitesData, aliasParTexte)
      );
      const lignesMat = extractionRecue.materiel.map((materiel) =>
        materielVersLigne(construireMaterielImporte(materiel, articlesTous, aliasParTexte), unitesData)
      );

      setArticlesPhoto(articlesTous);
      setUnitesPhoto(unitesData);
      setCategoriesPhoto(categoriesData);
      setSousCategoriesPhoto(sousCategoriesData);
      setLignesIngredientsPhoto(lignesIngr);
      setLignesMaterielPhoto(lignesMat);
      setExtractionPhoto(extractionRecue);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setEnCoursPhoto(false);
    }
  }

  // Applique la prévisualisation validée (voir PrevisualisationImportRecette.tsx, mode
  // complétion) directement par API — contrairement à RecetteForm.tsx (formulaire déjà ouvert,
  // fusion en état local avant enregistrement), ce modal n'a pas de formulaire ouvert : le payload
  // complet est reconstruit à partir de la recette existante récupérée du serveur, exactement
  // comme le fait déjà appliquer() ci-dessus pour le mode fichier — mêmes garanties (même
  // recetteId, jamais de doublon, aucun champ non ciblé par le patch n'est modifié).
  async function appliquerPatchPhoto(patch: PatchImportRecette) {
    const existante = recettesToutes.find((r) => r.id === recetteCibleId);
    if (!existante) return;

    try {
      await modifierRecette(recetteCibleId, {
        nom: patch.nom ?? existante.nom,
        categorieId: patch.categorieId !== undefined ? patch.categorieId : existante.categorieId,
        sousCategorieId: patch.sousCategorieId !== undefined ? patch.sousCategorieId : existante.sousCategorieId,
        portions: patch.portions ?? existante.portions,
        poidsPortionG: patch.poidsPortionG ?? existante.poidsPortionG,
        poidsAccompagnementG: patch.poidsAccompagnementG ?? existante.poidsAccompagnementG,
        prixVenteHT: existante.prixVenteHT,
        instructions: patch.instructionsAjoutees
          ? existante.instructions
            ? `${existante.instructions}\n\n${patch.instructionsAjoutees}`
            : patch.instructionsAjoutees
          : existante.instructions,
        photo: existante.photo,
        lignes: [
          ...existante.lignes.map((l) => ({
            articleId: l.articleId,
            articleConfirme: true,
            quantite: l.quantite,
            uniteId: l.uniteId,
            gainCuissonPct: l.gainCuissonPct,
          })),
          ...(patch.lignesAjoutees ?? []),
        ],
        etapes: [
          ...existante.etapes.map((e) => ({
            description: e.description,
            pointCritiqueHACCP: e.pointCritiqueHACCP,
            controleHACCP: e.controleHACCP,
          })),
          ...(patch.etapesAjoutees ?? []),
        ],
      });
      toast.success(`Techniques ajoutées à "${existante.nom}".`);
      setExtractionPhoto(null);
      setPhotoDataUrl(null);
      setRecetteCibleId(0);
      onImporte();
    } catch {
      toast.error(`Échec de l'ajout des techniques à "${existante.nom}"`);
    }
  }

  if (mode === "photo" && extractionPhoto) {
    const recetteCible = recettesToutes.find((r) => r.id === recetteCibleId) ?? null;
    return (
      <PrevisualisationImportRecette
        extraction={extractionPhoto}
        lignesIngredients={lignesIngredientsPhoto}
        lignesMateriel={lignesMaterielPhoto}
        articles={articlesPhoto}
        unites={unitesPhoto}
        categories={categoriesPhoto}
        sousCategories={sousCategoriesPhoto}
        modeCompletion
        recetteActuelle={recetteCible}
        onAnnuler={() => setExtractionPhoto(null)}
        onValiderCreation={() => {}}
        onValiderCompletion={appliquerPatchPhoto}
      />
    );
  }

  return (
    <div
      style={{
        background: "white",
        padding: 24,
        borderRadius: 10,
        width: 800,
        maxWidth: "95vw",
        maxHeight: "88vh",
        overflowY: "auto",
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
      }}
    >
      <h2 style={{ marginTop: 0 }}>Importer des techniques</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={mode === "fichier" ? "btn-primary" : undefined} onClick={() => setMode("fichier")}>
          Fichier
        </button>
        <button className={mode === "photo" ? "btn-primary" : undefined} onClick={() => setMode("photo")}>
          <Camera size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
          Photo
        </button>
      </div>

      {mode === "fichier" && (
        <>
          {recettesTechniques.length === 0 && (
            <div>
              <p style={{ color: "var(--couleur-texte-attenue)" }}>
                Sélectionne un fichier regroupant plusieurs fiches techniques (une feuille par
                recette) : chaque recette est rapprochée d'une fiche déjà existante par son nom, et
                ses étapes lui sont ajoutées — aucune nouvelle recette n'est créée.
              </p>
              <input type="file" accept=".xlsx,.xls,.ods" onChange={gererFichier} disabled={chargement} />
              {chargement && <p>Analyse du fichier…</p>}
              {erreur && <p style={{ color: "#b00020" }}>{erreur}</p>}
            </div>
          )}

          {recettesTechniques.length > 0 && (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                  padding: 12,
                  background: "var(--couleur-fond-attenue, #f5f5f5)",
                  borderRadius: 8,
                }}
              >
                <div>
                  {recettesTechniques.length} recette(s) trouvée(s) dans le fichier,{" "}
                  <strong>{nbApplicables} appariée(s)</strong> à une recette existante.
                </div>
                <button className="btn-primary" onClick={appliquerTout} disabled={nbApplicables === 0}>
                  Ajouter les étapes aux {nbApplicables} recette(s) appariée(s)
                </button>
              </div>

              {recettesTechniques.map((recette, index) => {
                const statut = statuts[index] ?? "attente";
                const correspondanceId = correspondanceChoisie[index] ?? 0;
                return (
                  <div
                    key={index}
                    style={{
                      border: "1px solid var(--couleur-bordure)",
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong>{recette.titre}</strong>
                      <span style={{ fontSize: 12, color: correspondanceId ? "#1a7a3c" : "#b00020" }}>
                        {statut === "ajoutee"
                          ? "Étapes ajoutées ✓"
                          : correspondanceId
                            ? "Appariée"
                            : "Aucune correspondance trouvée"}
                      </span>
                    </div>

                    <div style={{ margin: "8px 0" }}>
                      <select
                        value={correspondanceId}
                        onChange={(e) =>
                          setCorrespondanceChoisie((s) => ({ ...s, [index]: Number(e.target.value) }))
                        }
                        style={{ padding: 6, width: "100%" }}
                        disabled={statut === "ajoutee"}
                      >
                        <option value={0}>— aucune correspondance —</option>
                        {recettesToutes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.nom}
                          </option>
                        ))}
                      </select>
                    </div>

                    <details>
                      <summary style={{ cursor: "pointer", fontSize: 13 }}>
                        {recette.etapes.length} étape(s)
                        {recette.etapes.some((e) => e.pointCritiqueHACCP) &&
                          ` (dont ${recette.etapes.filter((e) => e.pointCritiqueHACCP).length} point(s) HACCP détecté(s))`}
                      </summary>
                      <ol style={{ fontSize: 13 }}>
                        {recette.etapes.map((etape, i) => (
                          <li key={i} style={{ marginBottom: 4 }}>
                            {etape.description}
                            {etape.pointCritiqueHACCP && (
                              <div style={{ color: "#b45309", fontSize: 12 }}>
                                ⚠ HACCP : {etape.controleHACCP}
                              </div>
                            )}
                          </li>
                        ))}
                      </ol>
                    </details>

                    <div style={{ marginTop: 8 }}>
                      <button
                        onClick={() => appliquer(index)}
                        disabled={!correspondanceId || statut === "en_cours" || statut === "ajoutee"}
                      >
                        {statut === "ajoutee"
                          ? "Étapes ajoutées"
                          : statut === "en_cours"
                            ? "Ajout en cours…"
                            : "Ajouter les étapes à cette recette"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {mode === "photo" && (
        <div>
          <p style={{ color: "var(--couleur-texte-attenue)" }}>
            Choisis la recette à compléter, puis photographie sa fiche technique (galerie ou
            caméra) : les techniques reconnues te seront proposées, à valider avant d'être ajoutées
            — rien n'est écrasé automatiquement, aucune nouvelle recette n'est créée.
          </p>

          <label style={{ display: "block", marginBottom: 12 }}>
            Recette à compléter
            <select
              value={recetteCibleId}
              onChange={(e) => setRecetteCibleId(Number(e.target.value))}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
            >
              <option value={0}>— choisir une recette —</option>
              {recettesToutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nom}
                </option>
              ))}
            </select>
          </label>

          <label
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              height: 200,
              borderRadius: 8,
              border: "1px dashed var(--couleur-bordure)",
              cursor: "pointer",
              backgroundSize: "cover",
              backgroundPosition: "center",
              color: photoDataUrl ? "white" : "var(--couleur-texte-attenue)",
              textShadow: photoDataUrl ? "0 1px 3px rgba(0,0,0,.6)" : undefined,
              backgroundImage: photoDataUrl ? `url(${photoDataUrl})` : undefined,
            }}
          >
            <Camera size={22} />
            {photoDataUrl ? "Changer la photo" : "Prendre ou choisir une photo de la fiche technique"}
            <input type="file" accept="image/*" capture="environment" hidden onChange={choisirPhoto} />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button
              className="btn-primary"
              onClick={analyserPhoto}
              disabled={enCoursPhoto || !photoDataUrl || !recetteCibleId}
            >
              {enCoursPhoto ? "Analyse en cours…" : "Analyser"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
        <button onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
