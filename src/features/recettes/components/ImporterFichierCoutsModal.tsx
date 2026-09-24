import { useState } from "react";
import toast from "react-hot-toast";
import { API_URL, apiFetch } from "../../../config/api";
import {
  creerRecette,
  getRecettes,
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
  aConflitDoublonImportCouts,
  detecterDoublonsInternes,
  indicesDoublonInterne as indicesDoublonInterneImport,
  trouverToutesCorrespondances,
  type RecetteExistantePourCorrespondance,
} from "../utils/correspondanceImportExcel";
import { normaliserTexte } from "../utils/normaliserTexte";

type CategorieRecette = { id: number; nom: string };
type SousCategorieRecette = { id: number; nom: string; parentId: number | null };

type Props = {
  onClose: () => void;
  onImporte: () => void;
};

type StatutRecette = "attente" | "en_cours" | "importee" | "erreur";

export default function ImporterFichierCoutsModal({ onClose, onImporte }: Props) {
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  const [recettes, setRecettes] = useState<RecetteCoutsExtraite[]>([]);
  const [catalogue, setCatalogue] = useState<Map<string, ArticleCatalogue>>(new Map());
  const [articlesParCode, setArticlesParCode] = useState<Map<string, ArticleTrouveParReference>>(
    new Map()
  );
  const [categories, setCategories] = useState<CategorieRecette[]>([]);
  const [sousCategories, setSousCategories] = useState<SousCategorieRecette[]>([]);

  const [categorieChoisie, setCategorieChoisie] = useState<Record<number, number>>({});
  const [sousCategorieChoisie, setSousCategorieChoisie] = useState<Record<number, number>>({});
  const [statuts, setStatuts] = useState<Record<number, StatutRecette>>({});
  // Suggestions d'assaisonnement de base cochées par défaut (voir analyserFichierCouts.ts) :
  // Record<index recette, tableau de booléens dans l'ordre de recette.suggestionsBase>.
  const [suggestionsCochees, setSuggestionsCochees] = useState<Record<number, boolean[]>>({});
  // Code article corrigé à la main par l'utilisateur pour une ligne d'ingrédient donnée, quand le
  // code extrait du fichier est absent ou mal rapproché : clé "indexRecette:indexLigne". Permet de
  // vérifier/choisir l'ingrédient exact avant import plutôt que de dépendre uniquement du
  // rapprochement automatique par code.
  const [codesCorriges, setCodesCorriges] = useState<Record<string, string>>({});
  // Recettes actives déjà en base au moment de l'import (voir gererFichier) : sert uniquement à
  // repérer un doublon potentiel, jamais à proposer une mise à jour — cet import ne fait que créer
  // (voir importerRecette), contrairement à l'import Excel sécurisé.
  const [recettesExistantes, setRecettesExistantes] = useState<RecetteExistantePourCorrespondance[]>([]);
  // Titres en double au sein même du fichier importé (voir detecterDoublonsInternes) : une clé de
  // titre normalisé -> les index (dans `recettes`) qui la partagent.
  const [doublonsInternes, setDoublonsInternes] = useState<Map<string, number[]>>(new Map());
  // Confirmation explicite de l'utilisateur, par index de recette, qu'il souhaite créer un doublon
  // malgré l'avertissement (voir aConflitDoublon) — jamais cochée par défaut, pour ne jamais créer
  // un doublon silencieusement (voir l'audit qui a motivé ce correctif).
  const [confirmationsDoublon, setConfirmationsDoublon] = useState<Record<number, boolean>>({});

  async function gererFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;

    setChargement(true);
    setErreur("");
    try {
      const [recettesExtraites, catalogueExtrait, categoriesData, sousCategoriesData, recettesActives] =
        await Promise.all([
          analyserFichierCouts(fichier),
          analyserCatalogueFichierCouts(fichier),
          apiFetch(`${API_URL}/categories-recette`).then((r) => r.json()),
          apiFetch(`${API_URL}/sous-categories-recette`).then((r) => r.json()),
          getRecettes(),
        ]);

      if (recettesExtraites.length === 0) {
        setErreur("Aucune recette reconnue dans ce fichier.");
        setChargement(false);
        return;
      }

      const codesUniques = [
        ...new Set(
          recettesExtraites.flatMap((r) => [
            ...r.lignes.map((l) => l.code),
            ...r.suggestionsBase.map((l) => l.code),
          ])
        ),
      ];
      const trouves = await rechercherArticlesParReferences(codesUniques);

      setRecettes(recettesExtraites);
      setCatalogue(catalogueExtrait);
      setArticlesParCode(new Map(trouves.map((t) => [t.reference, t])));
      setCategories(categoriesData);
      setSousCategories(sousCategoriesData);
      // getRecettes() ne renvoie que les recettes actives (voir GET /recettes) : toutes
      // implicitement actif=true ici, seul le champ attendu par trouverToutesCorrespondances.
      setRecettesExistantes(recettesActives.map((r) => ({ id: r.id, nom: r.nom, actif: true })));
      setDoublonsInternes(detecterDoublonsInternes(recettesExtraites));
      setConfirmationsDoublon({});

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

      const initSuggestions: Record<number, boolean[]> = {};
      recettesExtraites.forEach((recette, index) => {
        initSuggestions[index] = recette.suggestionsBase.map(() => true);
      });
      setSuggestionsCochees(initSuggestions);
    } catch {
      setErreur("Impossible de lire ce fichier. Formats acceptés : .xlsx, .xls, .ods");
    } finally {
      setChargement(false);
    }
  }

  // Code effectivement retenu pour une ligne d'ingrédient : la correction manuelle de
  // l'utilisateur si elle existe, sinon le code extrait du fichier.
  function codeEffectif(index: number, i: number, codeFichier: string): string {
    return codesCorriges[`${index}:${i}`] ?? codeFichier;
  }

  // Rapproche un code tapé à la main par l'utilisateur, s'il n'est pas déjà connu.
  async function verifierCode(code: string) {
    if (!code || articlesParCode.has(code)) return;
    const trouves = await rechercherArticlesParReferences([code]);
    if (trouves.length > 0) {
      setArticlesParCode((m) => new Map(m).set(trouves[0].reference, trouves[0]));
    }
  }

  // Autres index de `recettes` partageant le même titre normalisé que celui-ci (voir
  // indicesDoublonInterne dans correspondanceImportExcel.ts) — tableau vide si ce titre n'apparaît
  // qu'une fois dans le fichier.
  function indicesDoublonInterne(index: number): number[] {
    return indicesDoublonInterneImport(index, doublonsInternes);
  }

  // Recettes déjà en base dont le nom correspond (voir trouverToutesCorrespondances) : jamais
  // utilisé pour choisir une mise à jour à la place de l'utilisateur, seulement pour avertir avant
  // une création qui créerait un doublon.
  function correspondancesExistantes(index: number): RecetteExistantePourCorrespondance[] {
    return trouverToutesCorrespondances(recettes[index].titre, recettesExistantes);
  }

  function aConflitDoublon(index: number): boolean {
    return aConflitDoublonImportCouts(index, recettes[index].titre, doublonsInternes, recettesExistantes);
  }

  function estPrete(index: number): boolean {
    const recette = recettes[index];
    const ingredientsOk = recette.lignes.every((l, i) => articlesParCode.has(codeEffectif(index, i, l.code)));
    if (!ingredientsOk) return false;
    // Un doublon détecté (nom déjà en base, ou répété dans le fichier) bloque l'import tant que
    // l'utilisateur ne l'a pas confirmé explicitement (voir le correctif de l'audit import IA —
    // même principe que la prévisualisation obligatoire de l'import photo/texte : jamais de
    // création silencieuse en cas d'ambiguïté).
    if (aConflitDoublon(index) && !confirmationsDoublon[index]) return false;
    return true;
  }

  async function importerRecette(index: number) {
    const recette = recettes[index];
    if (!estPrete(index)) return;

    setStatuts((s) => ({ ...s, [index]: "en_cours" }));
    try {
      await creerRecette({
        societeId: 1,
        nom: recette.titre,
        categorieId: categorieChoisie[index] || null,
        sousCategorieId: sousCategorieChoisie[index] || null,
        portions: 1,
        poidsPortionG: null,
        poidsAccompagnementG: null,
        prixVenteHT: null,
        instructions: recette.allergenesTexte
          ? `Allergènes (source du fichier importé) : ${recette.allergenesTexte}`
          : null,
        photo: null,
        lignes: [
          ...recette.lignes.map((l, i) => ({ ...l, code: codeEffectif(index, i, l.code) })),
          ...recette.suggestionsBase.filter((_s, i) => suggestionsCochees[index]?.[i]),
        ]
          .filter((l) => articlesParCode.has(l.code))
          .map((l) => {
            const article = articlesParCode.get(l.code)!;
            return {
              articleId: article.articleId,
              // Rapproché par code article exact (référence), pas par une correspondance
              // approximative de texte comme l'import IA/OCR (voir ligneImportee.ts) — pas la même
              // ambiguïté à signaler ici.
              articleConfirme: true,
              quantite: l.quantite,
              uniteId: article.uniteId,
              gainCuissonPct: 0,
            };
          }),
        etapes: [],
      });
      setStatuts((s) => ({ ...s, [index]: "importee" }));
      onImporte();
    } catch {
      setStatuts((s) => ({ ...s, [index]: "erreur" }));
      toast.error(`Échec de l'import de "${recette.titre}"`);
    }
  }

  async function importerToutesLesRecettesPretes() {
    const indexPrets = recettes
      .map((_r, i) => i)
      .filter((i) => estPrete(i) && statuts[i] !== "importee");
    for (const index of indexPrets) {
      await importerRecette(index);
    }
    toast.success(`${indexPrets.length} recette(s) importée(s).`);
  }

  // Codes sans article correspondant, dédupliqués et triés par nombre de recettes qui les
  // utilisent : pour prioriser la création des articles manquants les plus utiles en premier.
  const codesManquants = (() => {
    const compte = new Map<string, { code: string; nom: string; nbRecettes: number }>();
    recettes.forEach((recette, index) => {
      const codesVus = new Set<string>();
      recette.lignes.forEach((ligne, i) => {
        const code = codeEffectif(index, i, ligne.code);
        if (articlesParCode.has(code) || codesVus.has(code)) return;
        codesVus.add(code);
        const entree = compte.get(code);
        const nom = catalogue.get(code)?.denomination ?? ligne.nomFichier;
        if (entree) entree.nbRecettes += 1;
        else compte.set(code, { code, nom, nbRecettes: 1 });
      });
    });
    return [...compte.values()].sort((a, b) => b.nbRecettes - a.nbRecettes);
  })();

  const nbPretes = recettes.filter((_r, index) => estPrete(index)).length;
  const nbConflitsNonConfirmes = recettes.filter(
    (_r, index) => aConflitDoublon(index) && !confirmationsDoublon[index]
  ).length;

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
      <h2 style={{ marginTop: 0 }}>Importer un fichier de coûts de recettes</h2>

      {recettes.length === 0 && (
        <div>
          <p style={{ color: "var(--couleur-texte-attenue)" }}>
            Sélectionne le fichier de fiches de coûts (.xlsx, .xls ou .ods), avec pour chaque
            ingrédient un code article : chaque code est rapproché de l'article correspondant dans
            ta base (par code exact, jamais par approximation). Les recettes dont un code ne
            correspond à aucun article te sont signalées avant tout import.
          </p>
          <input type="file" accept=".xlsx,.xls,.ods" onChange={gererFichier} disabled={chargement} />
          {chargement && <p>Analyse du fichier…</p>}
          {erreur && <p style={{ color: "#b00020" }}>{erreur}</p>}
        </div>
      )}

      {recettes.length > 0 && (
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
              {recettes.length} recette(s) trouvée(s), <strong>{nbPretes} prête(s)</strong> à
              importer.
              {codesManquants.length > 0 && (
                <span> {codesManquants.length} code(s) article sans correspondance.</span>
              )}
              {nbConflitsNonConfirmes > 0 && (
                <span style={{ color: "#b45309" }}>
                  {" "}
                  {nbConflitsNonConfirmes} doublon(s) potentiel(s) à confirmer.
                </span>
              )}
            </div>
            <button
              className="btn-primary"
              onClick={importerToutesLesRecettesPretes}
              disabled={nbPretes === 0}
            >
              Importer les {nbPretes} recette(s) prête(s)
            </button>
          </div>

          {codesManquants.length > 0 && (
            <details style={{ marginBottom: 16 }}>
              <summary style={{ cursor: "pointer", color: "#b00020" }}>
                Codes articles sans correspondance ({codesManquants.length})
              </summary>
              <ul style={{ fontSize: 13, color: "#b00020" }}>
                {codesManquants.map((c) => (
                  <li key={c.code}>
                    {c.code} — {c.nom} (utilisé dans {c.nbRecettes} recette
                    {c.nbRecettes > 1 ? "s" : ""})
                  </li>
                ))}
              </ul>
            </details>
          )}

          {recettes.map((recette, index) => {
            const prete = estPrete(index);
            const statut = statuts[index] ?? "attente";
            const nbSansCode = recette.lignes.filter(
              (l, i) => !articlesParCode.has(codeEffectif(index, i, l.code))
            ).length;
            const doublonsIndices = indicesDoublonInterne(index);
            const correspondances = correspondancesExistantes(index);
            const conflit = doublonsIndices.length > 0 || correspondances.length > 0;
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
                  <span style={{ fontSize: 12, color: prete ? "#1a7a3c" : "#b00020" }}>
                    {statut === "importee"
                      ? "Importée ✓"
                      : prete
                        ? "Prête"
                        : nbSansCode > 0
                          ? `${nbSansCode} ingrédient(s) sans code trouvé`
                          : "⚠ Doublon à confirmer"}
                  </span>
                </div>

                {conflit && (
                  <div
                    style={{
                      background: "#fff4e5",
                      border: "1px solid #f0b429",
                      borderRadius: 6,
                      padding: "8px 10px",
                      margin: "8px 0",
                      fontSize: 13,
                    }}
                  >
                    <strong>⚠ Doublon potentiel</strong>
                    {correspondances.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        Une recette portant ce nom existe déjà :{" "}
                        {correspondances.map((c) => `« ${c.nom} »`).join(", ")}. Importer créera une
                        recette supplémentaire, distincte de {correspondances.length > 1 ? "celles-ci" : "celle-ci"}.
                      </div>
                    )}
                    {doublonsIndices.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        Ce nom apparaît {doublonsIndices.length} fois dans ce fichier (recette
                        {doublonsIndices.length > 2 ? "s" : ""} n°
                        {doublonsIndices.filter((i) => i !== index).map((i) => i + 1).join(", ")}).
                      </div>
                    )}
                    <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                      <input
                        type="checkbox"
                        checked={confirmationsDoublon[index] ?? false}
                        disabled={statut === "importee"}
                        onChange={(e) =>
                          setConfirmationsDoublon((s) => ({ ...s, [index]: e.target.checked }))
                        }
                      />
                      Je confirme vouloir créer cette recette malgré le doublon détecté
                    </label>
                  </div>
                )}

                <div style={{ display: "flex", gap: 12, margin: "8px 0" }}>
                  <select
                    value={categorieChoisie[index] ?? 0}
                    onChange={(e) =>
                      setCategorieChoisie((s) => ({ ...s, [index]: Number(e.target.value) }))
                    }
                    style={{ padding: 6 }}
                    disabled={statut === "importee"}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sousCategorieChoisie[index] ?? 0}
                    onChange={(e) =>
                      setSousCategorieChoisie((s) => ({ ...s, [index]: Number(e.target.value) }))
                    }
                    style={{ padding: 6 }}
                    disabled={statut === "importee"}
                  >
                    <option value={0}>— sous-catégorie —</option>
                    {sousCategories.map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {sc.parentId !== null ? `- ${sc.nom}` : sc.nom}
                      </option>
                    ))}
                  </select>
                </div>

                <details>
                  <summary style={{ cursor: "pointer", fontSize: 13 }}>
                    {recette.lignes.length} ingrédient(s)
                  </summary>
                  <p style={{ fontSize: 12, color: "var(--couleur-texte-attenue)", margin: "4px 0" }}>
                    Vérifie chaque code article : corrige-le directement si le rapprochement est
                    manquant ou ne correspond pas à l'ingrédient attendu.
                  </p>
                  <ul style={{ fontSize: 13, listStyle: "none", padding: 0 }}>
                    {recette.lignes.map((ligne, i) => {
                      const code = codeEffectif(index, i, ligne.code);
                      const article = articlesParCode.get(code);
                      return (
                        <li
                          key={i}
                          style={{
                            color: article ? undefined : "#b00020",
                            marginBottom: 6,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
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
                            disabled={statut === "importee"}
                            style={{ width: 100, fontSize: 12, padding: "2px 4px" }}
                          />
                          <span>{article ? `→ ${article.nom}` : "→ code introuvable"}</span>
                        </li>
                      );
                    })}
                  </ul>
                </details>

                {recette.suggestionsBase.length > 0 && (
                  <div style={{ fontSize: 13, marginTop: 8 }}>
                    <div style={{ color: "var(--couleur-texte-attenue)" }}>
                      Assaisonnement de base détecté dans la majorité des recettes du fichier,
                      absent de celle-ci — à confirmer :
                    </div>
                    {recette.suggestionsBase.map((suggestion, i) => (
                      <label key={i} style={{ display: "block" }}>
                        <input
                          type="checkbox"
                          checked={suggestionsCochees[index]?.[i] ?? true}
                          disabled={statut === "importee"}
                          onChange={(e) =>
                            setSuggestionsCochees((s) => {
                              const tableau = [...(s[index] ?? recette.suggestionsBase.map(() => true))];
                              tableau[i] = e.target.checked;
                              return { ...s, [index]: tableau };
                            })
                          }
                        />{" "}
                        {suggestion.quantite} × {suggestion.nomFichier}
                      </label>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => importerRecette(index)}
                    disabled={!prete || statut === "en_cours" || statut === "importee"}
                  >
                    {statut === "importee"
                      ? "Importée"
                      : statut === "en_cours"
                        ? "Import en cours…"
                        : "Importer cette recette"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
        <button onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
