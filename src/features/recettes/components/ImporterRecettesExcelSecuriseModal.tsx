import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { API_URL, apiFetch } from "../../../config/api";
import {
  getRecetteDetail,
  getRecettesPourCorrespondance,
  importerRecettesExcel,
  rechercherArticlesParReferences,
  type ArticleTrouveParReference,
} from "../services/recetteService";
import {
  analyserCatalogueFichierCouts,
  analyserFichierCouts,
  type ArticleCatalogue,
  type RecetteCoutsExtraite,
} from "../utils/analyserFichierCouts";
import {
  classifierRecetteImport,
  detecterDoublonsInternes,
  type RecetteExistantePourCorrespondance,
  type StatutRecetteImport,
} from "../utils/correspondanceImportExcel";
import { normaliserTexte } from "../utils/normaliserTexte";
import type { DecisionImportExcel, Recette } from "../types/recette";

type CategorieRecette = { id: number; nom: string };
type SousCategorieRecette = { id: number; nom: string; parentId: number | null };

type Props = {
  onClose: () => void;
  onImporte: () => void;
};

// Statut d'affichage combinant le statut brut (correspondance + doublon interne) avec les
// résolutions manuelles de l'utilisateur (choix d'un candidat en cas d'ambiguïté, décision sur une
// occurrence en doublon interne, ou ignorance explicite) — jamais de décision implicite : tant
// qu'une résolution manque, le statut reste "ambiguite" ou "doublon_interne" non résolu.
type StatutAffiche =
  | { type: "ignoree" }
  | { type: "creation" }
  | { type: "mise_a_jour"; recette: RecetteExistantePourCorrespondance }
  | { type: "ambiguite"; candidats: RecetteExistantePourCorrespondance[] }
  | { type: "doublon_interne"; indicesLies: number[] };

export default function ImporterRecettesExcelSecuriseModal({ onClose, onImporte }: Props) {
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  const [recettes, setRecettes] = useState<RecetteCoutsExtraite[]>([]);
  const [catalogue, setCatalogue] = useState<Map<string, ArticleCatalogue>>(new Map());
  const [articlesParCode, setArticlesParCode] = useState<Map<string, ArticleTrouveParReference>>(
    new Map()
  );
  const [recettesExistantes, setRecettesExistantes] = useState<RecetteExistantePourCorrespondance[]>(
    []
  );
  const [categories, setCategories] = useState<CategorieRecette[]>([]);
  const [sousCategories, setSousCategories] = useState<SousCategorieRecette[]>([]);

  const [categorieChoisie, setCategorieChoisie] = useState<Record<number, number>>({});
  const [sousCategorieChoisie, setSousCategorieChoisie] = useState<Record<number, number>>({});
  const [codesCorriges, setCodesCorriges] = useState<Record<string, string>>({});

  // Résolutions manuelles — jamais de choix automatique (voir la règle absolue de l'import).
  const [resolutionsDoublons, setResolutionsDoublons] = useState<
    Record<number, "creer" | "ignorer">
  >({});
  const [resolutionsAmbiguite, setResolutionsAmbiguite] = useState<Record<number, number | "creer">>(
    {}
  );
  const [ignoreesManuelles, setIgnoreesManuelles] = useState<Record<number, boolean>>({});

  // Détail complet (étapes, HACCP, notes, photo) des recettes reconnues, chargé à la demande pour
  // le bloc « CONSERVÉ » — jamais utilisé pour construire le payload d'import, qui ne transmet
  // jamais ces champs (voir construireDecisions ci-dessous).
  const [detailsExistantes, setDetailsExistantes] = useState<Record<number, Recette>>({});
  const enChargementRef = useRef<Set<number>>(new Set());

  const [apercuCouts, setApercuCouts] = useState<Record<number, number> | null>(null);
  const [calculEnCours, setCalculEnCours] = useState(false);
  const [validationEnCours, setValidationEnCours] = useState(false);
  const [resultatFinal, setResultatFinal] = useState<{ misesAJour: number; creees: number } | null>(
    null
  );

  const doublonsInternes = useMemo(() => detecterDoublonsInternes(recettes), [recettes]);

  async function gererFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;

    setChargement(true);
    setErreur("");
    try {
      const [recettesExtraites, catalogueExtrait, recettesData, categoriesData, sousCategoriesData] =
        await Promise.all([
          analyserFichierCouts(fichier),
          analyserCatalogueFichierCouts(fichier),
          getRecettesPourCorrespondance(),
          apiFetch(`${API_URL}/categories-recette`).then((r) => r.json()),
          apiFetch(`${API_URL}/sous-categories-recette`).then((r) => r.json()),
        ]);

      if (recettesExtraites.length === 0) {
        setErreur("Aucune recette reconnue dans ce fichier.");
        setChargement(false);
        return;
      }

      const codesUniques = [...new Set(recettesExtraites.flatMap((r) => r.lignes.map((l) => l.code)))];
      const trouves = await rechercherArticlesParReferences(codesUniques);

      setRecettes(recettesExtraites);
      setCatalogue(catalogueExtrait);
      setArticlesParCode(new Map(trouves.map((t) => [t.reference, t])));
      setRecettesExistantes(recettesData);
      setCategories(categoriesData);
      setSousCategories(sousCategoriesData);

      const initCategorie: Record<number, number> = {};
      const initSousCategorie: Record<number, number> = {};
      recettesExtraites.forEach((recette, index) => {
        const categorie = categoriesData.find(
          (c: CategorieRecette) => normaliserTexte(c.nom) === normaliserTexte(recette.categorieParDefaut)
        );
        initCategorie[index] = categorie?.id ?? categoriesData[0]?.id ?? 0;
        if (recette.sousCategorieParDefaut) {
          const sousCategorie = sousCategoriesData.find(
            (sc: SousCategorieRecette) =>
              sc.parentId === null &&
              normaliserTexte(sc.nom) === normaliserTexte(recette.sousCategorieParDefaut ?? "")
          );
          initSousCategorie[index] = sousCategorie?.id ?? 0;
        } else {
          initSousCategorie[index] = 0;
        }
      });
      setCategorieChoisie(initCategorie);
      setSousCategorieChoisie(initSousCategorie);
    } catch {
      setErreur("Impossible de lire ce fichier. Formats acceptés : .xlsx, .xls, .ods");
    } finally {
      setChargement(false);
    }
  }

  function codeEffectif(index: number, i: number, codeFichier: string): string {
    return codesCorriges[`${index}:${i}`] ?? codeFichier;
  }

  async function verifierCode(code: string) {
    if (!code || articlesParCode.has(code)) return;
    const trouves = await rechercherArticlesParReferences([code]);
    if (trouves.length > 0) {
      setArticlesParCode((m) => new Map(m).set(trouves[0].reference, trouves[0]));
    }
  }

  // Statut affiché pour une recette du fichier : combine le statut brut (correspondance + doublon
  // interne, calculé par une fonction pure et testée unitairement) avec les résolutions manuelles
  // de l'utilisateur. Ne choisit jamais rien automatiquement : un cas C ou D sans résolution reste
  // "ambiguite" / "doublon_interne", ce qui bloque la validation (voir peutEtreValidee).
  function statutAffiche(index: number): StatutAffiche {
    if (ignoreesManuelles[index]) return { type: "ignoree" };

    const brut: StatutRecetteImport = classifierRecetteImport(
      index,
      recettes[index].titre,
      doublonsInternes,
      recettesExistantes
    );

    if (brut.type === "doublon_interne") {
      const resolution = resolutionsDoublons[index];
      if (resolution === "ignorer") return { type: "ignoree" };
      if (resolution === "creer") {
        // Cette occurrence est traitée isolément, comme si elle n'était plus en doublon : la
        // correspondance normale (cas A/B/C) s'applique désormais à elle seule.
        const isole = classifierRecetteImport(index, recettes[index].titre, new Map(), recettesExistantes);
        return isole.type === "doublon_interne" ? { type: "creation" } : isole;
      }
      return brut;
    }

    if (brut.type === "ambiguite") {
      const choix = resolutionsAmbiguite[index];
      if (choix === "creer") return { type: "creation" };
      if (typeof choix === "number") {
        const recetteChoisie = brut.candidats.find((c) => c.id === choix);
        if (recetteChoisie) return { type: "mise_a_jour", recette: recetteChoisie };
      }
      return brut;
    }

    return brut;
  }

  function ingredientsResolus(index: number): boolean {
    return recettes[index].lignes.every((l, i) => articlesParCode.has(codeEffectif(index, i, l.code)));
  }

  // Cas réel identifié à l'audit : "SAUTE DE VEAU MARENGO" et "SAUTE DE VEAU AUX OLIVES"
  // correspondent chacune, individuellement, à l'unique recette existante "Saute de veau" — deux
  // décisions distinctes viseraient alors la même recette dans le même lot. Sans cette détection,
  // les deux seraient envoyées telles quelles et la deuxième écraserait silencieusement le
  // résultat de la première (voir aussi le garde-fou équivalent côté serveur, POST
  // /import-excel) : jamais résolu automatiquement, toujours signalé et bloquant.
  function indicesEnConflitDecriture(index: number): number[] {
    const statut = statutAffiche(index);
    if (statut.type !== "mise_a_jour") return [];
    const cible = statut.recette.id;
    const groupe = recettes
      .map((_r, i) => i)
      .filter((i) => {
        const s = statutAffiche(i);
        return s.type === "mise_a_jour" && s.recette.id === cible;
      });
    return groupe.length > 1 ? groupe : [];
  }

  function peutEtreValidee(index: number): boolean {
    const statut = statutAffiche(index);
    if (statut.type === "ignoree") return true;
    if (statut.type === "ambiguite" || statut.type === "doublon_interne") return false;
    if (statut.type === "mise_a_jour" && indicesEnConflitDecriture(index).length > 0) return false;
    return ingredientsResolus(index);
  }

  const peutValiderImport =
    recettes.length > 0 && recettes.every((_r, index) => peutEtreValidee(index));

  const compteurs = useMemo(() => {
    let misesAJour = 0;
    let creees = 0;
    let ignorees = 0;
    let enAttente = 0;
    recettes.forEach((_r, index) => {
      const statut = statutAffiche(index);
      if (statut.type === "mise_a_jour" && indicesEnConflitDecriture(index).length > 0) enAttente++;
      else if (statut.type === "mise_a_jour") misesAJour++;
      else if (statut.type === "creation") creees++;
      else if (statut.type === "ignoree") ignorees++;
      else enAttente++;
    });
    return { misesAJour, creees, ignorees, enAttente };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recettes, resolutionsDoublons, resolutionsAmbiguite, ignoreesManuelles, recettesExistantes, doublonsInternes]);

  // Charge à la demande le détail complet (étapes, HACCP, notes, photo) de chaque recette
  // désormais reconnue avec certitude, pour l'afficher en lecture seule dans le bloc « CONSERVÉ ».
  useEffect(() => {
    recettes.forEach((_r, index) => {
      const statut = statutAffiche(index);
      if (statut.type !== "mise_a_jour") return;
      const id = statut.recette.id;
      if (id in detailsExistantes || enChargementRef.current.has(id)) return;
      enChargementRef.current.add(id);
      getRecetteDetail(id)
        .then((recette) => setDetailsExistantes((prev) => ({ ...prev, [id]: recette })))
        .catch(() => {})
        .finally(() => enChargementRef.current.delete(id));
    });
  });

  function construireDecisions(): { index: number; decision: DecisionImportExcel }[] {
    const sortie: { index: number; decision: DecisionImportExcel }[] = [];
    recettes.forEach((recette, index) => {
      const statut = statutAffiche(index);
      if (statut.type === "ignoree" || statut.type === "ambiguite" || statut.type === "doublon_interne") {
        return;
      }

      const lignes = recette.lignes
        .map((l, i) => codeEffectif(index, i, l.code))
        .map((code) => articlesParCode.get(code))
        .filter((article): article is ArticleTrouveParReference => article != null)
        .map((article, i) => ({
          articleId: article.articleId,
          quantite: recette.lignes[i].quantite,
          uniteId: article.uniteId,
        }));

      if (statut.type === "creation") {
        sortie.push({
          index,
          decision: {
            action: "creer",
            nom: recette.titre,
            categorieId: categorieChoisie[index] || null,
            sousCategorieId: sousCategorieChoisie[index] || null,
            societeId: 1,
            lignes,
          },
        });
      } else {
        sortie.push({ index, decision: { action: "mettre_a_jour", recetteId: statut.recette.id, lignes } });
      }
    });
    return sortie;
  }

  async function calculerApercu() {
    setCalculEnCours(true);
    try {
      const paires = construireDecisions();
      const reponse = await importerRecettesExcel(
        paires.map((p) => p.decision),
        true
      );
      const parIndex: Record<number, number> = {};
      reponse.resultats.forEach((resultat, i) => {
        parIndex[paires[i].index] = resultat.recette.coutTotal;
      });
      setApercuCouts(parIndex);
    } catch {
      toast.error("Impossible de calculer l'aperçu des coûts.");
    } finally {
      setCalculEnCours(false);
    }
  }

  async function validerImport() {
    if (!peutValiderImport) return;
    setValidationEnCours(true);
    try {
      const paires = construireDecisions();
      const reponse = await importerRecettesExcel(
        paires.map((p) => p.decision),
        false
      );
      const misesAJour = reponse.resultats.filter((r) => r.action === "mettre_a_jour").length;
      const creees = reponse.resultats.filter((r) => r.action === "creer").length;
      setResultatFinal({ misesAJour, creees });
      toast.success(
        `${misesAJour} recette(s) mise(s) à jour, ${creees} recette(s) créée(s). Techniques, HACCP, notes et photos inchangés.`
      );
      onImporte();
    } catch {
      toast.error("Échec de l'import — aucune modification n'a été conservée (transaction annulée).");
    } finally {
      setValidationEnCours(false);
    }
  }

  return (
    <div
      style={{
        background: "white",
        padding: 24,
        borderRadius: 10,
        width: 900,
        maxWidth: "96vw",
        maxHeight: "90vh",
        overflowY: "auto",
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
      }}
    >
      <h2 style={{ marginTop: 0 }}>Importer Excel (sécurisé)</h2>
      <p style={{ color: "var(--couleur-texte-attenue)", fontSize: 13 }}>
        Met à jour uniquement les ingrédients, quantités et coûts des recettes déjà présentes
        (reconnues par leur nom) et ne crée une nouvelle recette que si aucune n'existe. Les
        étapes, points HACCP, contrôles HACCP, notes et photo d'une recette existante ne sont
        jamais modifiés par cet import.
      </p>

      {recettes.length === 0 && (
        <div>
          <input type="file" accept=".xlsx,.xls,.ods" onChange={gererFichier} disabled={chargement} />
          {chargement && <p>Analyse du fichier…</p>}
          {erreur && <p style={{ color: "#b00020" }}>{erreur}</p>}
        </div>
      )}

      {recettes.length > 0 && !resultatFinal && (
        <div>
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 16,
              padding: 12,
              background: "var(--couleur-fond-attenue, #f5f5f5)",
              borderRadius: 8,
            }}
          >
            <span>{recettes.length} recette(s) trouvée(s) dans le fichier</span>
            <span style={{ color: "#1a7a3c" }}>{compteurs.misesAJour} mise(s) à jour</span>
            <span style={{ color: "#1a5a9c" }}>{compteurs.creees} création(s)</span>
            <span style={{ color: "#888" }}>{compteurs.ignorees} ignorée(s)</span>
            {compteurs.enAttente > 0 && (
              <span style={{ color: "#b00020", fontWeight: 600 }}>
                {compteurs.enAttente} décision(s) manquante(s)
              </span>
            )}
            <button onClick={calculerApercu} disabled={calculEnCours}>
              {calculEnCours ? "Calcul…" : "Calculer les coûts (aperçu)"}
            </button>
            <button
              className="btn-primary"
              onClick={validerImport}
              disabled={!peutValiderImport || validationEnCours}
              title={
                peutValiderImport
                  ? undefined
                  : "Résous toutes les ambiguïtés, doublons internes et codes articles manquants avant de valider."
              }
            >
              {validationEnCours ? "Import en cours…" : "Valider l'import"}
            </button>
          </div>

          {recettes.map((recette, index) => {
            const statut = statutAffiche(index);
            const nbSansCode = recette.lignes.filter(
              (l, i) => !articlesParCode.has(codeEffectif(index, i, l.code))
            ).length;
            const existante =
              statut.type === "mise_a_jour" ? detailsExistantes[statut.recette.id] : undefined;
            const conflit = statut.type === "mise_a_jour" ? indicesEnConflitDecriture(index) : [];

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
                  <div>
                    <strong>{recette.titre}</strong>{" "}
                    <span style={{ fontSize: 12, color: "#888" }}>({recette.feuille})</span>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color:
                        statut.type === "mise_a_jour"
                          ? "#1a7a3c"
                          : statut.type === "creation"
                            ? "#1a5a9c"
                            : statut.type === "ignoree"
                              ? "#888"
                              : "#b00020",
                    }}
                  >
                    {statut.type === "mise_a_jour" && conflit.length === 0 &&
                      `Mise à jour — ${statut.recette.nom}${statut.recette.actif ? "" : " (inactive)"}`}
                    {statut.type === "mise_a_jour" && conflit.length > 0 && "Conflit — décision requise"}
                    {statut.type === "creation" && "Création"}
                    {statut.type === "ignoree" && "Ignorée"}
                    {statut.type === "ambiguite" && "Ambiguïté — décision requise"}
                    {statut.type === "doublon_interne" && "Doublon dans le fichier — décision requise"}
                  </span>
                </div>

                {statut.type === "mise_a_jour" && conflit.length > 0 && (
                  <div style={{ marginTop: 8, padding: 8, background: "#fdecea", borderRadius: 6, fontSize: 13 }}>
                    <div>
                      Conflit : {conflit.length} recettes du fichier ({conflit.map((i) => recettes[i].titre).join(" / ")})
                      correspondent toutes à la même recette existante « {statut.recette.nom} ». Une seule peut la
                      mettre à jour — jamais choisie automatiquement, jamais les deux en même temps (cela écraserait
                      silencieusement l'une par l'autre).
                    </div>
                    <button
                      style={{ marginTop: 6 }}
                      onClick={() =>
                        setIgnoreesManuelles((s) => {
                          const copie = { ...s };
                          conflit.filter((i) => i !== index).forEach((i) => (copie[i] = true));
                          return copie;
                        })
                      }
                    >
                      Garder celle-ci pour la mise à jour (ignorer les autres)
                    </button>
                  </div>
                )}

                {statut.type === "doublon_interne" && (
                  <div style={{ marginTop: 8, padding: 8, background: "#fff4e5", borderRadius: 6, fontSize: 13 }}>
                    <div>
                      Ce titre apparaît {statut.indicesLies.length} fois dans le fichier (occurrences :{" "}
                      {statut.indicesLies.map((i) => recettes[i].feuille).join(", ")}). Chaque occurrence a sa
                      propre composition et doit être décidée séparément — jamais fusionnée automatiquement.
                    </div>
                    <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                      <button onClick={() => setResolutionsDoublons((s) => ({ ...s, [index]: "creer" }))}>
                        Traiter cette occurrence séparément
                      </button>
                      <button onClick={() => setResolutionsDoublons((s) => ({ ...s, [index]: "ignorer" }))}>
                        Ignorer cette occurrence
                      </button>
                    </div>
                  </div>
                )}

                {statut.type === "ambiguite" && (
                  <div style={{ marginTop: 8, padding: 8, background: "#fff4e5", borderRadius: 6, fontSize: 13 }}>
                    <div>
                      {statut.candidats.length} recettes existantes pourraient correspondre — choisis
                      explicitement laquelle, ou "Aucune correspondance" pour créer une nouvelle recette :
                    </div>
                    <select
                      value={resolutionsAmbiguite[index] ?? ""}
                      onChange={(e) =>
                        setResolutionsAmbiguite((s) => ({
                          ...s,
                          [index]: e.target.value === "creer" ? "creer" : Number(e.target.value),
                        }))
                      }
                      style={{ marginTop: 6, padding: 6, width: "100%" }}
                    >
                      <option value="">— choisir —</option>
                      {statut.candidats.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nom}
                          {c.actif ? "" : " (inactive)"}
                        </option>
                      ))}
                      <option value="creer">Aucune correspondance — créer une nouvelle recette</option>
                    </select>
                  </div>
                )}

                {statut.type === "creation" && (
                  <div style={{ display: "flex", gap: 12, margin: "8px 0" }}>
                    <select
                      value={categorieChoisie[index] ?? 0}
                      onChange={(e) => setCategorieChoisie((s) => ({ ...s, [index]: Number(e.target.value) }))}
                      style={{ padding: 6 }}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nom}
                        </option>
                      ))}
                    </select>
                    <select
                      value={sousCategorieChoisie[index] ?? 0}
                      onChange={(e) => setSousCategorieChoisie((s) => ({ ...s, [index]: Number(e.target.value) }))}
                      style={{ padding: 6 }}
                    >
                      <option value={0}>— sous-catégorie —</option>
                      {sousCategories.map((sc) => (
                        <option key={sc.id} value={sc.id}>
                          {sc.parentId !== null ? `- ${sc.nom}` : sc.nom}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(statut.type === "mise_a_jour" || statut.type === "creation") && (
                  <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#1a5a9c" }}>MODIFIÉ</div>
                      <ul style={{ fontSize: 13, listStyle: "none", padding: 0 }}>
                        {recette.lignes.map((ligne, i) => {
                          const code = codeEffectif(index, i, ligne.code);
                          const article = articlesParCode.get(code);
                          return (
                            <li
                              key={i}
                              style={{
                                color: article ? undefined : "#b00020",
                                marginBottom: 4,
                                display: "flex",
                                gap: 6,
                                alignItems: "center",
                                flexWrap: "wrap",
                              }}
                            >
                              <span>
                                {ligne.quantite} × {ligne.nomFichier} — code
                              </span>
                              <input
                                type="text"
                                value={code}
                                onChange={(e) =>
                                  setCodesCorriges((s) => ({ ...s, [`${index}:${i}`]: e.target.value.trim() }))
                                }
                                onBlur={(e) => verifierCode(e.target.value.trim())}
                                style={{ width: 90, fontSize: 12, padding: "2px 4px" }}
                              />
                              <span>
                                {article
                                  ? `→ ${article.nom}`
                                  : `→ code introuvable${catalogue.get(code)?.denomination ? ` (${catalogue.get(code)!.denomination})` : ""}`}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {nbSansCode > 0 && (
                        <div style={{ fontSize: 12, color: "#b00020" }}>
                          {nbSansCode} ingrédient(s) sans code trouvé — corrige le code ou{" "}
                          <button
                            style={{ fontSize: 12, padding: "1px 6px" }}
                            onClick={() => setIgnoreesManuelles((s) => ({ ...s, [index]: true }))}
                          >
                            ignorer cette recette
                          </button>
                        </div>
                      )}
                      {apercuCouts && index in apercuCouts && (
                        <div style={{ fontSize: 13, marginTop: 6 }}>
                          Coût total résultant : <strong>{apercuCouts[index].toFixed(2)} €</strong>
                        </div>
                      )}
                    </div>

                    {statut.type === "mise_a_jour" && (
                      <div style={{ flex: 1, minWidth: 260 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#6b7280" }}>
                          CONSERVÉ (lecture seule, jamais modifié par cet import)
                        </div>
                        {!existante && <p style={{ fontSize: 12, color: "#888" }}>Chargement…</p>}
                        {existante && (
                          <div style={{ fontSize: 13 }}>
                            <div>
                              {existante.etapes.length} étape(s)
                              {existante.etapes.some((e) => e.pointCritiqueHACCP) &&
                                ` (dont ${existante.etapes.filter((e) => e.pointCritiqueHACCP).length} point(s) HACCP)`}
                            </div>
                            <ol style={{ margin: "4px 0", paddingLeft: 18 }}>
                              {existante.etapes.map((e) => (
                                <li key={e.id} style={{ marginBottom: 2 }}>
                                  {e.description}
                                  {e.pointCritiqueHACCP && (
                                    <span style={{ color: "#b45309" }}> — HACCP : {e.controleHACCP}</span>
                                  )}
                                </li>
                              ))}
                            </ol>
                            <div>Notes : {existante.instructions ? existante.instructions : "—"}</div>
                            <div>Photo : {existante.photo ? "conservée" : "aucune"}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {statut.type !== "doublon_interne" && statut.type !== "ambiguite" && statut.type !== "ignoree" && (
                  <button
                    style={{ fontSize: 12, marginTop: 8, padding: "2px 8px" }}
                    onClick={() => setIgnoreesManuelles((s) => ({ ...s, [index]: true }))}
                  >
                    Ignorer cette recette
                  </button>
                )}
                {statut.type === "ignoree" && !resolutionsDoublons[index] && (
                  <button
                    style={{ fontSize: 12, marginTop: 8, padding: "2px 8px" }}
                    onClick={() =>
                      setIgnoreesManuelles((s) => {
                        const copie = { ...s };
                        delete copie[index];
                        return copie;
                      })
                    }
                  >
                    Annuler l'ignorance
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {resultatFinal && (
        <div style={{ padding: 12, background: "#eef7ee", borderRadius: 8 }}>
          Import terminé : <strong>{resultatFinal.misesAJour}</strong> recette(s) mise(s) à jour,{" "}
          <strong>{resultatFinal.creees}</strong> recette(s) créée(s). Techniques, points HACCP,
          contrôles HACCP, notes et photos des recettes mises à jour sont restés strictement
          inchangés.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
        <button onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
