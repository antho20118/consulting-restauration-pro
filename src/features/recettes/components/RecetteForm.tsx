import toast from "react-hot-toast";
import { useEffect, useMemo, useState } from "react";
import { API_URL, apiFetch } from "../../../config/api";
import ChampNombre from "../../../common/ChampNombre";
import { redimensionnerImage } from "../../../common/redimensionnerImage";
import {
  creerRecette,
  enregistrerAliasIngredients,
  getArticlesDisponibles,
  getRecettes,
  getUnitesDisponibles,
  modifierRecette,
} from "../services/recetteService";
import { estimerCoutLigne } from "../utils/cout";
import {
  trouverToutesCorrespondances,
  type RecetteExistantePourCorrespondance,
} from "../utils/correspondanceImportExcel";
import { definirFiltrerSuperU, estFournisseurSuperU, filtrerSuperUActif } from "../utils/filtreFournisseur";
import { POINTS_CRITIQUES_HACCP } from "../utils/pointsCritiquesHACCP";
import {
  modeApresChangementPoidsPortion,
  peutPasserEnModeKg,
  poidsTotalInitialKg,
  portionsDepuisPoidsTotalKg,
} from "../utils/quantiteAProduire";
import { trouverUniteParDefaut } from "../utils/uniteParDefaut";
import { calculerAllergenesAvecStatut, ligneIncomplete } from "../utils/validationLignes";
import ImporterRecetteModal from "./ImporterRecetteModal";
import RechercheArticle from "./RechercheArticle";
import type {
  ArticleRecette,
  BrouillonRecette,
  EtapeRecetteInput,
  LigneRecetteInput,
  PatchImportRecette,
  Recette,
  UniteRecette,
} from "../types/recette";

type CategorieRecette = {
  id: number;
  nom: string;
};

type SousCategorieRecette = {
  id: number;
  nom: string;
  parentId: number | null;
};

type Props = {
  recette: Recette | null;
  brouillon?: BrouillonRecette;
  onClose: () => void;
  onSave: () => void;
};

export default function RecetteForm({ recette, brouillon, onClose, onSave }: Props) {
  const [nom, setNom] = useState(recette?.nom ?? brouillon?.nom ?? "");
  const [categorieId, setCategorieId] = useState<number>(
    recette?.categorieId ?? brouillon?.categorieId ?? 0
  );
  const [sousCategorieId, setSousCategorieId] = useState<number>(
    recette?.sousCategorieId ?? brouillon?.sousCategorieId ?? 0
  );
  const [portions, setPortions] = useState(recette?.portions ?? brouillon?.portions ?? 1);
  const [poidsPortionG, setPoidsPortionG] = useState(
    recette?.poidsPortionG ?? brouillon?.poidsPortionG ?? 0
  );
  const [poidsAccompagnementG, setPoidsAccompagnementG] = useState(
    recette?.poidsAccompagnementG ?? brouillon?.poidsAccompagnementG ?? 0
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
  const [instructions, setInstructions] = useState(recette?.instructions ?? brouillon?.instructions ?? "");
  const [photo, setPhoto] = useState<string | null>(recette?.photo ?? null);
  const [lignes, setLignes] = useState<LigneRecetteInput[]>(
    recette?.lignes.map((ligne) => ({
      articleId: ligne.articleId,
      // Ligne d'une recette déjà enregistrée : l'article a déjà été validé une première fois par
      // un humain lors de cet enregistrement, contrairement à une ligne fraîchement importée par
      // IA/OCR (voir LigneRecetteInput.articleConfirme) — pas de bandeau « à confirmer » ici.
      articleConfirme: true,
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
  const [sousCategories, setSousCategories] = useState<SousCategorieRecette[]>([]);
  const [articles, setArticles] = useState<ArticleRecette[]>([]);
  const [unites, setUnites] = useState<UniteRecette[]>([]);
  const [importOuvert, setImportOuvert] = useState(false);
  // Restreint la recherche d'ingrédient aux articles fournis par Super U par défaut (voir
  // filtreFournisseur.ts) ; mémorisé pour ne pas avoir à le redéfinir à chaque recette.
  const [filtrerSuperU, setFiltrerSuperU] = useState(filtrerSuperUActif);
  // Recettes actives déjà en base, chargées uniquement en création (jamais en modification, voir
  // correspondancesRecette ci-dessous) : sert uniquement à repérer un doublon potentiel avant
  // d'enregistrer, jamais à bloquer une modification existante — le renommage d'une recette déjà
  // enregistrée (PUT /:id) reste un problème distinct, volontairement hors de ce correctif.
  const [recettesExistantes, setRecettesExistantes] = useState<RecetteExistantePourCorrespondance[]>([]);
  // Nom pour lequel l'utilisateur a explicitement confirmé vouloir créer un doublon malgré
  // l'avertissement (voir correspondancesRecette) — null si aucune confirmation en cours. Comparé
  // au nom actuel (confirmationDoublon ci-dessous) plutôt que d'être un simple booléen, pour
  // qu'une confirmation donnée pour un nom ne valide jamais silencieusement la création d'un
  // doublon différent après modification du champ Nom.
  const [nomConfirmeDoublon, setNomConfirmeDoublon] = useState<string | null>(null);

  function changerFiltrerSuperU(valeur: boolean) {
    setFiltrerSuperU(valeur);
    definirFiltrerSuperU(valeur);
  }

  useEffect(() => {
    // Pas de présélection pour une nouvelle recette (import IA ou création manuelle) : la
    // catégorie la première par ordre alphabétique n'a aucun rapport avec le contenu de la
    // recette — un champ silencieusement rempli d'une valeur arbitraire est plus trompeur qu'un
    // champ visiblement vide (voir l'audit import IA). La recette conserve sa propre catégorie en
    // modification (recette?.categorieId déjà utilisé dans l'état initial).
    apiFetch(`${API_URL}/categories-recette`)
      .then((r) => r.json())
      .then(setCategories);

    apiFetch(`${API_URL}/sous-categories-recette`)
      .then((r) => r.json())
      .then(setSousCategories);

    getArticlesDisponibles().then(setArticles);

    getUnitesDisponibles().then((data) => {
      setUnites(data);
    });

    // Uniquement en création : une modification ne crée jamais de doublon par elle-même (voir le
    // commentaire de recettesExistantes ci-dessus).
    if (!recette) {
      // getRecettes() ne renvoie que les recettes actives (voir GET /recettes) : une recette
      // inactive du même nom ne bloque donc jamais une nouvelle création, par construction.
      getRecettes().then((data) =>
        setRecettesExistantes(data.map((r) => ({ id: r.id, nom: r.nom, actif: true })))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recettes déjà en base dont le nom correspond au nom en cours de saisie (voir
  // trouverToutesCorrespondances, déjà utilisée et testée pour l'import Excel sécurisé et l'import
  // de fichier de coûts) — jamais calculé en modification, pour ne jamais bloquer l'enregistrement
  // d'une recette existante sur son propre nom.
  const correspondancesRecette = useMemo(
    () => (recette ? [] : trouverToutesCorrespondances(nom, recettesExistantes)),
    [recette, nom, recettesExistantes]
  );
  const confirmationDoublon = nomConfirmeDoublon === nom;

  function ajouterLigne() {
    setLignes((precedent) => [
      ...precedent,
      {
        // Pas de présélection : le champ de recherche reste vide pour écrire directement, plutôt
        // que de forcer à effacer le premier article de la liste avant de pouvoir taper.
        articleId: 0,
        // Ligne ajoutée explicitement par l'utilisateur : aucune décision automatique à signaler,
        // contrairement à une ligne issue d'un import IA/OCR (voir LigneRecetteInput.articleConfirme).
        articleConfirme: true,
        quantite: 0,
        // Ici uniquement (pas à l'import, voir ligneImportee.ts) : un point de départ visible que
        // l'utilisateur ajuste lui-même en remplissant une ligne qu'il vient de créer, pas un
        // repli silencieux sur une valeur devinée pour une ligne déjà "remplie" en apparence.
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
    const nouvellesPortions = portionsDepuisPoidsTotalKg(kg, poidsPortionG);
    if (nouvellesPortions !== null) {
      setPortions(nouvellesPortions);
    }
  }

  function passerEnModeKg() {
    if (!peutPasserEnModeKg(poidsPortionG)) {
      toast.error(
        "Renseigne d'abord le poids d'une portion (en grammes, ci-dessous) pour pouvoir saisir la quantité à produire en kg."
      );
      return;
    }
    setPoidsTotalKgSaisi(poidsTotalInitialKg(portions, poidsPortionG));
    setModeQuantite("poids");
  }

  // Bug corrigé (23/09) : si le poids d'une portion repasse à 0 (ou négatif) alors qu'on est déjà
  // en mode Kg, ce mode n'a plus de sens — sans ce retour automatique en mode Portions, le champ
  // "Quantité à produire" en kg continuait à accepter des saisies (affichait la nouvelle valeur
  // tapée) sans plus jamais mettre à jour `portions`, silencieusement.
  function changerPoidsPortionG(valeur: number) {
    setPoidsPortionG(valeur);
    setModeQuantite((modeActuel) => modeApresChangementPoidsPortion(modeActuel, valeur));
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

  // Applique le résultat validé d'une prévisualisation d'import (voir
  // PrevisualisationImportRecette.tsx) à ce formulaire déjà ouvert : chaque champ scalaire n'est
  // présent dans le patch que si l'utilisateur a explicitement choisi de l'appliquer (aucun
  // écrasement silencieux), les ingrédients/matériel/étapes retenus sont toujours ajoutés à ceux
  // déjà présents, jamais substitués.
  function appliquerImport(patch: PatchImportRecette) {
    if (patch.nom !== undefined) setNom(patch.nom);
    if (patch.categorieId !== undefined) setCategorieId(patch.categorieId ?? 0);
    if (patch.sousCategorieId !== undefined) setSousCategorieId(patch.sousCategorieId ?? 0);
    if (patch.portions !== undefined) setPortions(patch.portions);
    if (patch.poidsPortionG !== undefined) changerPoidsPortionG(patch.poidsPortionG);
    if (patch.poidsAccompagnementG !== undefined) setPoidsAccompagnementG(patch.poidsAccompagnementG);
    if (patch.lignesAjoutees?.length) setLignes((precedent) => [...precedent, ...patch.lignesAjoutees!]);
    if (patch.etapesAjoutees?.length) setEtapes((precedent) => [...precedent, ...patch.etapesAjoutees!]);
    if (patch.instructionsAjoutees) {
      setInstructions((precedent) =>
        precedent ? `${precedent}\n\n${patch.instructionsAjoutees}` : patch.instructionsAjoutees!
      );
    }
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
  // utilisés). `incertain` signale qu'un de ces ingrédients vient d'un rapprochement automatique
  // (import IA/OCR) pas encore confirmé — voir validationLignes.ts.
  const { allergenes, incertain: allergenesIncertains } = useMemo(
    () => calculerAllergenesAvecStatut(lignes, articles),
    [lignes, articles]
  );

  // Sélection en cascade : sousCategorieId porte la valeur finale (racine ou enfant), mais le
  // formulaire affiche deux listes — la racine (Viande, Poisson...) puis, si elle a des enfants
  // (Bœuf, Veau...), une seconde liste pour préciser. Dérivé plutôt que stocké dans un second
  // état pour ne jamais désynchroniser les deux.
  const sousCategorieSelectionnee = sousCategories.find((sc) => sc.id === sousCategorieId);
  const sousCategorieRacineId = sousCategorieSelectionnee?.parentId ?? sousCategorieId;
  const sousCategoriesRacines = sousCategories.filter((sc) => sc.parentId === null);
  const sousCategoriesEnfants = sousCategories.filter((sc) => sc.parentId === sousCategorieRacineId);
  const sousCategorieRacine = sousCategoriesRacines.find((sc) => sc.id === sousCategorieRacineId);

  async function enregistrer() {
    if (lignes.some((ligne) => ligneIncomplete(ligne) === "article")) {
      toast.error("Choisis un ingrédient pour chaque ligne (ou supprime les lignes vides).");
      return;
    }
    if (lignes.some((ligne) => ligneIncomplete(ligne) === "unite")) {
      toast.error(
        "Choisis une unité pour chaque ligne : l'import n'a pas pu la déterminer automatiquement pour au moins un ingrédient."
      );
      return;
    }
    // Doublon détecté (nom déjà en base) et non confirmé explicitement : bloque l'enregistrement,
    // même principe que le correctif de l'import de fichier de coûts — jamais de création
    // silencieuse d'une recette déjà existante.
    if (correspondancesRecette.length > 0 && !confirmationDoublon) {
      toast.error(
        "Une recette portant ce nom existe déjà : coche la confirmation pour créer quand même ce doublon."
      );
      return;
    }

    const payload = {
      nom,
      categorieId: categorieId || null,
      sousCategorieId: sousCategorieId || null,
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

      {correspondancesRecette.length > 0 && (
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
            Une recette portant ce nom existe déjà :{" "}
            {correspondancesRecette.map((c) => `« ${c.nom} »`).join(", ")}. Enregistrer créera une
            recette supplémentaire, distincte de{" "}
            {correspondancesRecette.length > 1 ? "celles-ci" : "celle-ci"}.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={confirmationDoublon}
              onChange={(e) => setNomConfirmeDoublon(e.target.checked ? nom : null)}
            />
            Je confirme vouloir créer cette recette malgré le doublon détecté
          </label>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: 20 }}>
        <div style={{ flex: "0 1 auto" }}>
          <label>Catégorie</label>
          <select
            value={categorieId}
            onChange={(e) => setCategorieId(Number(e.target.value))}
            style={{ width: "auto", maxWidth: "100%", padding: 10 }}
          >
            <option value={0}>— À définir —</option>
            {categories.map((categorie) => (
              <option key={categorie.id} value={categorie.id}>
                {categorie.nom}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: "0 1 auto" }}>
          <label>Sous-catégorie</label>
          <select
            value={sousCategorieRacineId}
            onChange={(e) => setSousCategorieId(Number(e.target.value))}
            style={{ width: "auto", maxWidth: "100%", padding: 10 }}
          >
            <option value={0}>—</option>
            {sousCategoriesRacines.map((sousCategorie) => (
              <option key={sousCategorie.id} value={sousCategorie.id}>
                {sousCategorie.nom}
              </option>
            ))}
          </select>
        </div>

        {sousCategoriesEnfants.length > 0 && (
          <div style={{ flex: "0 1 auto" }}>
            <label>Type de {sousCategorieRacine?.nom.toLowerCase()}</label>
            <select
              value={sousCategoriesEnfants.some((sc) => sc.id === sousCategorieId) ? sousCategorieId : 0}
              onChange={(e) => setSousCategorieId(Number(e.target.value) || sousCategorieRacineId)}
              style={{ width: "auto", maxWidth: "100%", padding: 10 }}
            >
              <option value={0}>—</option>
              {sousCategoriesEnfants.map((sousCategorie) => (
                <option key={sousCategorie.id} value={sousCategorie.id}>
                  {sousCategorie.nom}
                </option>
              ))}
            </select>
          </div>
        )}

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
            onChanger={(n) => changerPoidsPortionG(n ?? 0)}
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
          <div key={index} style={{ marginBottom: 10 }}>
            {!ligne.articleConfirme && (
              <div style={{ fontSize: 12, color: "#b3261e", marginBottom: 2 }}>
                ⚠ Article rapproché automatiquement à l'import — à vérifier puis confirmer (choisis-le
                à nouveau dans le champ ci-dessous, même si c'est le bon).
              </div>
            )}
            {ligne.articleId !== 0 && !ligne.uniteId && (
              <div style={{ fontSize: 12, color: "#b3261e", marginBottom: 2 }}>
                ⚠ Unité non déterminée par l'import — choisis-la avant d'enregistrer.
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                ...(!ligne.articleConfirme
                  ? { background: "#fdecea", borderRadius: 6, padding: "4px 6px", margin: "-4px -6px" }
                  : {}),
              }}
            >
              <RechercheArticle
                articles={articlesPourLigne}
                articlesRepli={filtrerSuperU ? articles : undefined}
                articleId={ligne.articleId}
                onChange={(articleId) => modifierLigne(index, { articleId, articleConfirme: true })}
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
                <option value={0}>— à choisir —</option>
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
          </div>
        );
      })}

      <button onClick={ajouterLigne} style={{ display: "block", marginBottom: 20 }}>
        + Ajouter un ingrédient
      </button>

      {allergenes.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <label>Allergènes (déduits des ingrédients)</label>
          {allergenesIncertains && (
            <div style={{ fontSize: 12, color: "#b3261e", marginBottom: 6 }}>
              ⚠ Liste possiblement incomplète ou inexacte : au moins un ingrédient rapproché
              automatiquement à l'import n'est pas encore confirmé (voir ci-dessus).
            </div>
          )}
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
              ref={(el) => {
                // Hauteur recalculée à chaque rendu (frappe, import de techniques, chargement
                // d'une recette existante…) plutôt qu'une hauteur fixe qui tronquerait un texte
                // long derrière une barre de défilement.
                if (!el) return;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              value={etape.description}
              onChange={(e) => modifierEtape(index, { description: e.target.value })}
              placeholder="Description de l'étape (geste, technique à mettre en œuvre…)"
              rows={2}
              style={{ flex: 1, padding: 8, boxSizing: "border-box", resize: "none", overflow: "hidden" }}
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
            <>
              <select
                value=""
                onChange={(e) => {
                  const point = POINTS_CRITIQUES_HACCP.find((p) => p.titre === e.target.value);
                  if (point) modifierEtape(index, { controleHACCP: point.description });
                }}
                style={{ width: "100%", padding: 8, marginTop: 8 }}
              >
                <option value="">— Choisir un point critique HACCP —</option>
                {POINTS_CRITIQUES_HACCP.map((point) => (
                  <option key={point.titre} value={point.titre}>
                    {point.titre}
                  </option>
                ))}
              </select>
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
            </>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button onClick={ajouterEtape}>+ Ajouter une étape</button>
        <button onClick={() => setImportOuvert(true)}>Importer depuis une photo ou un texte</button>
      </div>

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
            zIndex: 20,
          }}
        >
          <ImporterRecetteModal
            onClose={() => setImportOuvert(false)}
            recetteActuelle={recette}
            onComplete={appliquerImport}
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
