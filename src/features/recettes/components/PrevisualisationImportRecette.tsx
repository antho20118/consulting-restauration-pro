import { useState } from "react";
import ChampNombre from "../../../common/ChampNombre";
import { normaliserTexte } from "../utils/normaliserTexte";
import RechercheArticle from "./RechercheArticle";
import type {
  ArticleRecette,
  BrouillonRecette,
  Confiance,
  EtapeRecetteInput,
  ExtractionRecette,
  LigneRecetteInput,
  PatchImportRecette,
  Recette,
  SectionEtape,
  UniteRecette,
} from "../types/recette";

type CategorieOption = { id: number; nom: string; parentId?: number | null };

type Props = {
  extraction: ExtractionRecette;
  // Lignes déjà rapprochées côté client (voir construireLigneImportee / materielVersLigne dans
  // ligneImportee.ts), dans le même ordre que extraction.ingredients / extraction.materiel —
  // l'utilisateur peut encore les corriger ici avant de valider (voir section 13 de la refonte).
  lignesIngredients: LigneRecetteInput[];
  lignesMateriel: LigneRecetteInput[];
  articles: ArticleRecette[];
  unites: UniteRecette[];
  categories: CategorieOption[];
  sousCategories: CategorieOption[];
  // true si l'import se fait dans un formulaire déjà ouvert (voir ImporterRecetteModal.tsx) —
  // déterminé par l'appelant, jamais déduit de recetteActuelle (qui reste null pour une recette pas
  // encore enregistrée mais dont le formulaire est bien déjà ouvert).
  modeCompletion: boolean;
  // La recette déjà persistée quand elle existe — sert uniquement à comparer "valeur actuelle" pour
  // chaque champ scalaire (ajout vs remplacement, voir section 16 de la refonte : ne jamais écraser
  // silencieusement une donnée existante). null pour une nouvelle recette, même en mode complétion.
  recetteActuelle: Recette | null;
  onAnnuler: () => void;
  onValiderCreation: (brouillon: BrouillonRecette) => void;
  onValiderCompletion: (patch: PatchImportRecette) => void;
};

const LABELS_CONFIANCE: Record<Confiance, { bg: string; fg: string; label: string }> = {
  elevee: { bg: "#e6f4ea", fg: "#1a7a3c", label: "Confiance élevée" },
  moyenne: { bg: "#fff4e5", fg: "#b45309", label: "Confiance moyenne" },
  faible: { bg: "#fdecea", fg: "#b3261e", label: "Confiance faible" },
};

function BadgeConfiance({ confiance }: { confiance: Confiance }) {
  const c = LABELS_CONFIANCE[confiance];
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        borderRadius: 10,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {c.label}
    </span>
  );
}

const LABELS_SECTION: Record<SectionEtape, string> = {
  preparation: "Préparation",
  cuisson: "Cuisson",
  dressage: "Dressage",
  autre: "Autre",
};
const ORDRE_SECTIONS: SectionEtape[] = ["preparation", "cuisson", "dressage", "autre"];

// Résout un nom détecté (catégorie/sous-catégorie) vers son id réel dans l'application — jamais de
// création à la volée ni d'approximation floue : si le nom exact (accents/casse ignorés) n'existe
// pas parmi les options réelles, la détection est considérée non applicable (l'utilisateur choisira
// lui-même dans le formulaire).
function resoudreCategorie(nomDetecte: string | undefined, options: CategorieOption[]): CategorieOption | null {
  if (!nomDetecte) return null;
  const cible = normaliserTexte(nomDetecte);
  return options.find((o) => normaliserTexte(o.nom) === cible) ?? null;
}

type EtatChampScalaire<T> = { appliquer: boolean; valeur: T };

// Un champ scalaire détecté peut être : absent de la recette actuelle (proposé comme un ajout, coché
// par défaut), déjà renseigné différemment (proposé comme un remplacement, décoché par défaut pour
// ne jamais écraser silencieusement), ou identique (rien à proposer).
function initialiserChampScalaire<T>(
  valeurDetectee: T | null | undefined,
  valeurActuelle: T | null | undefined,
  modeCompletion: boolean
): EtatChampScalaire<T> | null {
  if (valeurDetectee == null) return null;
  const vide = valeurActuelle == null || valeurActuelle === 0 || valeurActuelle === "";
  const identique = valeurActuelle === valeurDetectee;
  if (modeCompletion && identique) return null;
  return { appliquer: !modeCompletion || vide, valeur: valeurDetectee };
}

export default function PrevisualisationImportRecette({
  extraction,
  lignesIngredients,
  lignesMateriel,
  articles,
  unites,
  categories,
  sousCategories,
  modeCompletion,
  recetteActuelle,
  onAnnuler,
  onValiderCreation,
  onValiderCompletion,
}: Props) {
  const categorieResolue = resoudreCategorie(extraction.categorieDetectee?.nom, categories);
  const sousCategorieResolue = resoudreCategorie(extraction.sousCategorieDetectee?.nom, sousCategories);

  const [nom, setNom] = useState(() =>
    initialiserChampScalaire(extraction.nom ?? undefined, recetteActuelle?.nom, modeCompletion)
  );
  const [categorie, setCategorie] = useState(() =>
    initialiserChampScalaire(categorieResolue, recetteActuelle?.categorie, modeCompletion)
  );
  const [sousCategorie, setSousCategorie] = useState(() =>
    initialiserChampScalaire(sousCategorieResolue, recetteActuelle?.sousCategorie, modeCompletion)
  );
  const [portions, setPortions] = useState(() =>
    initialiserChampScalaire(extraction.portions ?? undefined, recetteActuelle?.portions, modeCompletion)
  );
  const [poidsPortionG, setPoidsPortionG] = useState(() =>
    initialiserChampScalaire(extraction.poidsPortionG ?? undefined, recetteActuelle?.poidsPortionG, modeCompletion)
  );
  const [poidsAccompagnementG, setPoidsAccompagnementG] = useState(() =>
    initialiserChampScalaire(
      extraction.poidsAccompagnementG ?? undefined,
      recetteActuelle?.poidsAccompagnementG,
      modeCompletion
    )
  );
  const [instructionsRetenues, setInstructionsRetenues] = useState(extraction.instructions != null);

  const [ingredientsRetenus, setIngredientsRetenus] = useState(() => extraction.ingredients.map(() => true));
  const [lignesIngredientsEditees, setLignesIngredientsEditees] = useState(lignesIngredients);
  const [materielRetenu, setMaterielRetenu] = useState(() => extraction.materiel.map(() => true));
  const [lignesMaterielEditees, setLignesMaterielEditees] = useState(lignesMateriel);
  const [etapesRetenues, setEtapesRetenues] = useState(() => extraction.etapes.map(() => true));

  function modifierLigneIngredient(index: number, changement: Partial<LigneRecetteInput>) {
    setLignesIngredientsEditees((precedent) =>
      precedent.map((ligne, i) => (i === index ? { ...ligne, ...changement } : ligne))
    );
  }

  function modifierLigneMateriel(index: number, changement: Partial<LigneRecetteInput>) {
    setLignesMaterielEditees((precedent) =>
      precedent.map((ligne, i) => (i === index ? { ...ligne, ...changement } : ligne))
    );
  }

  function valider() {
    const lignesRetenues = [
      ...lignesIngredientsEditees.filter((_l, i) => ingredientsRetenus[i]),
      ...lignesMaterielEditees.filter((_l, i) => materielRetenu[i]),
    ];
    const etapesFinales: EtapeRecetteInput[] = extraction.etapes
      .filter((_e, i) => etapesRetenues[i])
      .map((e) => ({ description: e.description, pointCritiqueHACCP: e.pointCritiqueHACCP, controleHACCP: e.controleHACCP }));

    if (!modeCompletion) {
      const brouillon: BrouillonRecette = {
        nom: nom?.appliquer ? nom.valeur : undefined,
        categorieId: categorie?.appliquer ? categorie.valeur.id : undefined,
        sousCategorieId: sousCategorie?.appliquer ? sousCategorie.valeur.id : undefined,
        portions: portions?.appliquer ? portions.valeur : undefined,
        poidsPortionG: poidsPortionG?.appliquer ? poidsPortionG.valeur : undefined,
        poidsAccompagnementG: poidsAccompagnementG?.appliquer ? poidsAccompagnementG.valeur : undefined,
        instructions: instructionsRetenues && extraction.instructions ? extraction.instructions : undefined,
        lignes: lignesRetenues,
        etapes: etapesFinales,
      };
      onValiderCreation(brouillon);
      return;
    }

    const patch: PatchImportRecette = {
      nom: nom?.appliquer ? nom.valeur : undefined,
      categorieId: categorie?.appliquer ? categorie.valeur.id : undefined,
      sousCategorieId: sousCategorie?.appliquer ? sousCategorie.valeur.id : undefined,
      portions: portions?.appliquer ? portions.valeur : undefined,
      poidsPortionG: poidsPortionG?.appliquer ? poidsPortionG.valeur : undefined,
      poidsAccompagnementG: poidsAccompagnementG?.appliquer ? poidsAccompagnementG.valeur : undefined,
      instructionsAjoutees: instructionsRetenues && extraction.instructions ? extraction.instructions : undefined,
      lignesAjoutees: lignesRetenues.length > 0 ? lignesRetenues : undefined,
      etapesAjoutees: etapesFinales.length > 0 ? etapesFinales : undefined,
    };
    onValiderCompletion(patch);
  }

  function ligneChampScalaire<T>(
    label: string,
    etat: EtatChampScalaire<T> | null,
    setEtat: (v: EtatChampScalaire<T> | null) => void,
    formater: (v: T) => string,
    valeurActuelleFormatee: string | null
  ) {
    if (!etat) return null;
    const remplacement = modeCompletion && valeurActuelleFormatee != null;
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={etat.appliquer}
          onChange={(e) => setEtat({ ...etat, appliquer: e.target.checked })}
        />
        <span>
          <strong>{label} :</strong> {formater(etat.valeur)}
          {remplacement && (
            <span style={{ color: "#888", fontSize: 12 }}> (remplace la valeur actuelle : {valeurActuelleFormatee})</span>
          )}
          {!remplacement && modeCompletion && <span style={{ color: "#1a7a3c", fontSize: 12 }}> (ajout)</span>}
        </span>
      </label>
    );
  }

  const etapesParSection = ORDRE_SECTIONS.map((section) => ({
    section,
    etapes: extraction.etapes
      .map((etape, index) => ({ etape, index }))
      .filter(({ etape }) => etape.section === section),
  })).filter((g) => g.etapes.length > 0);

  return (
    <div
      style={{
        background: "white",
        padding: 24,
        borderRadius: 10,
        width: 820,
        maxWidth: "95vw",
        maxHeight: "90vh",
        overflowY: "auto",
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
      }}
    >
      <h2 style={{ marginTop: 0 }}>
        Prévisualisation de l'import{" "}
        {modeCompletion ? `— compléter ${recetteActuelle ? `« ${recetteActuelle.nom} »` : "la recette en cours"}` : "— nouvelle recette"}
      </h2>
      <p style={{ color: "var(--couleur-texte-attenue)", fontSize: 13 }}>
        Vérifie et corrige chaque élément avant de l'appliquer : rien n'est enregistré tant que tu
        n'as pas validé cette prévisualisation, puis le formulaire de recette habituel.
        {modeCompletion &&
          " Les ingrédients, étapes et matériel déjà présents dans la recette ne sont jamais supprimés ni modifiés : seuls les éléments cochés ci-dessous seront ajoutés."}
      </p>

      {extraction.alertes.length > 0 && (
        <div
          style={{
            background: "#fff4e5",
            border: "1px solid #f0b429",
            borderRadius: 8,
            padding: 12,
            marginBottom: 20,
          }}
        >
          <strong>⚠ Alertes</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            {extraction.alertes.map((alerte, i) => (
              <li key={i} style={{ fontSize: 13 }}>{alerte}</li>
            ))}
          </ul>
        </div>
      )}

      <h3>Informations générales</h3>
      {ligneChampScalaire("Nom", nom, setNom, (v) => v, recetteActuelle?.nom || null)}
      {extraction.categorieDetectee && (
        <div style={{ marginBottom: 6 }}>
          {categorieResolue ? (
            ligneChampScalaire(
              "Catégorie détectée",
              categorie,
              setCategorie,
              (v) => v.nom,
              recetteActuelle?.categorie?.nom ?? null
            )
          ) : (
            <div style={{ fontSize: 13, color: "#b3261e" }}>
              Catégorie détectée « {extraction.categorieDetectee.nom} » — introuvable parmi les
              catégories existantes, à choisir manuellement dans le formulaire.
            </div>
          )}
          <span style={{ marginLeft: 26 }}>
            <BadgeConfiance confiance={extraction.categorieDetectee.confiance} />
          </span>
        </div>
      )}
      {extraction.sousCategorieDetectee && (
        <div style={{ marginBottom: 6 }}>
          {sousCategorieResolue ? (
            ligneChampScalaire(
              "Sous-catégorie détectée",
              sousCategorie,
              setSousCategorie,
              (v) => v.nom,
              recetteActuelle?.sousCategorie?.nom ?? null
            )
          ) : (
            <div style={{ fontSize: 13, color: "#b3261e" }}>
              Sous-catégorie détectée « {extraction.sousCategorieDetectee.nom} » — introuvable, à
              choisir manuellement.
            </div>
          )}
          <span style={{ marginLeft: 26 }}>
            <BadgeConfiance confiance={extraction.sousCategorieDetectee.confiance} />
          </span>
        </div>
      )}
      {ligneChampScalaire(
        "Portions",
        portions,
        setPortions,
        (v) => String(v),
        recetteActuelle ? String(recetteActuelle.portions) : null
      )}
      {ligneChampScalaire(
        "Poids d'une portion (g)",
        poidsPortionG,
        setPoidsPortionG,
        (v) => String(v),
        recetteActuelle?.poidsPortionG != null ? String(recetteActuelle.poidsPortionG) : null
      )}
      {ligneChampScalaire(
        "Poids d'accompagnement (g)",
        poidsAccompagnementG,
        setPoidsAccompagnementG,
        (v) => String(v),
        recetteActuelle?.poidsAccompagnementG != null ? String(recetteActuelle.poidsAccompagnementG) : null
      )}

      <h3>Ingrédients ({extraction.ingredients.length})</h3>
      {extraction.ingredients.length === 0 && <p style={{ color: "#888", fontSize: 13 }}>Aucun ingrédient détecté.</p>}
      {extraction.ingredients.map((ingredient, index) => {
        const ligne = lignesIngredientsEditees[index];
        const unite = unites.find((u) => u.id === ligne.uniteId);
        return (
          <div
            key={index}
            style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 8 }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <input
                type="checkbox"
                checked={ingredientsRetenus[index]}
                onChange={(e) =>
                  setIngredientsRetenus((p) => p.map((v, i) => (i === index ? e.target.checked : v)))
                }
                style={{ marginTop: 10 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "#888" }}>
                  Texte original : « {ingredient.texteOriginal} »
                  {ingredient.precision && ` (${ingredient.precision})`}
                  <span style={{ marginLeft: 8 }}>
                    <BadgeConfiance confiance={ingredient.confiance} />
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, minWidth: 140 }}>
                    Nom extrait : <strong>{ingredient.nomExtrait}</strong>
                  </span>
                  <RechercheArticle
                    articles={articles}
                    articleId={ligne.articleId}
                    onChange={(articleId) => modifierLigneIngredient(index, { articleId, articleConfirme: false })}
                  />
                  <ChampNombre
                    valeur={ligne.quantite}
                    onChanger={(n) => modifierLigneIngredient(index, { quantite: n ?? 0 })}
                    style={{ width: 80, padding: 6 }}
                  />
                  <select
                    value={ligne.uniteId}
                    onChange={(e) => modifierLigneIngredient(index, { uniteId: Number(e.target.value) })}
                    style={{ padding: 6 }}
                  >
                    <option value={0}>— unité —</option>
                    {unites.map((u) => (
                      <option key={u.id} value={u.id}>{u.symbole}</option>
                    ))}
                  </select>
                </div>
                <div style={{ fontSize: 12, color: ligne.articleId ? "#1a7a3c" : "#b3261e", marginTop: 4 }}>
                  {ligne.articleId
                    ? `Article proposé : ${articles.find((a) => a.id === ligne.articleId)?.nom ?? "—"} — à confirmer`
                    : "Aucun article correspondant trouvé — à résoudre dans le formulaire"}
                  {!unite && ligne.articleId !== 0 && " · unité non déterminée"}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <h3>Matériel ({extraction.materiel.length})</h3>
      {extraction.materiel.length === 0 && <p style={{ color: "#888", fontSize: 13 }}>Aucun matériel détecté.</p>}
      {extraction.materiel.map((materiel, index) => {
        const ligne = lignesMaterielEditees[index];
        const articlesMateriel = articles.filter((a) => a.type === "PETIT_MATERIEL");
        return (
          <div
            key={index}
            style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 8 }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <input
                type="checkbox"
                checked={materielRetenu[index]}
                onChange={(e) => setMaterielRetenu((p) => p.map((v, i) => (i === index ? e.target.checked : v)))}
                style={{ marginTop: 4 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "#888" }}>
                  Texte original : « {materiel.texteOriginal} »
                  <span style={{ marginLeft: 8 }}>
                    <BadgeConfiance confiance={materiel.confiance} />
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <span style={{ fontSize: 13, minWidth: 140 }}>
                    Nom extrait : <strong>{materiel.nomExtrait}</strong>
                  </span>
                  <RechercheArticle
                    articles={articlesMateriel}
                    articleId={ligne.articleId}
                    onChange={(articleId) => modifierLigneMateriel(index, { articleId, articleConfirme: false })}
                  />
                </div>
                <div style={{ fontSize: 12, color: ligne.articleId ? "#1a7a3c" : "#b3261e", marginTop: 4 }}>
                  {ligne.articleId ? "Article proposé — à confirmer" : "Aucun matériel correspondant trouvé — à résoudre dans le formulaire"}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <h3>Techniques ({extraction.etapes.length})</h3>
      {extraction.etapes.length === 0 && <p style={{ color: "#888", fontSize: 13 }}>Aucune étape détectée.</p>}
      {etapesParSection.map(({ section, etapes }) => (
        <div key={section} style={{ marginBottom: 12 }}>
          <h4 style={{ marginBottom: 6 }}>{LABELS_SECTION[section]}</h4>
          {etapes.map(({ etape, index }) => (
            <div
              key={index}
              style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 6 }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={etapesRetenues[index]}
                  onChange={(e) => setEtapesRetenues((p) => p.map((v, i) => (i === index ? e.target.checked : v)))}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{etape.ordre}. {etape.titre ?? ""}</strong>
                    <BadgeConfiance confiance={etape.confiance} />
                  </div>
                  <p style={{ margin: "4px 0", whiteSpace: "pre-wrap", fontSize: 13 }}>{etape.description}</p>
                  <div style={{ fontSize: 12, color: "#666", display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {etape.temperatureC != null && <span>🌡 {etape.temperatureC} °C</span>}
                    {etape.dureeMinutes != null && <span>⏱ {etape.dureeMinutes} min</span>}
                    {etape.modeCuisson && <span>🔥 {etape.modeCuisson}</span>}
                    {etape.pointCritiqueHACCP && (
                      <span style={{ color: "#b45309" }}>
                        ⚠ HACCP{etape.controleHACCP ? ` : ${etape.controleHACCP}` : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      {extraction.instructions && (
        <>
          <h3>Notes complémentaires</h3>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <input
              type="checkbox"
              checked={instructionsRetenues}
              onChange={(e) => setInstructionsRetenues(e.target.checked)}
              style={{ marginTop: 4 }}
            />
            <span style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{extraction.instructions}</span>
          </label>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
        <button onClick={onAnnuler}>Annuler</button>
        <button className="btn-primary" onClick={valider}>
          {modeCompletion ? "Appliquer à la recette" : "Créer la recette à partir de cet import"}
        </button>
      </div>
    </div>
  );
}
