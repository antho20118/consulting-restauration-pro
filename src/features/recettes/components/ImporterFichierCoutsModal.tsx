import { useState } from "react";
import toast from "react-hot-toast";
import { API_URL, apiFetch } from "../../../config/api";
import {
  creerRecette,
  rechercherArticlesParReferences,
  type ArticleTrouveParReference,
} from "../services/recetteService";
import {
  analyserCatalogueFichierCouts,
  analyserFichierCouts,
  type ArticleCatalogue,
  type RecetteCoutsExtraite,
} from "../utils/analyserFichierCouts";
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

  async function gererFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;

    setChargement(true);
    setErreur("");
    try {
      const [recettesExtraites, catalogueExtrait, categoriesData, sousCategoriesData] =
        await Promise.all([
          analyserFichierCouts(fichier),
          analyserCatalogueFichierCouts(fichier),
          apiFetch(`${API_URL}/categories-recette`).then((r) => r.json()),
          apiFetch(`${API_URL}/sous-categories-recette`).then((r) => r.json()),
        ]);

      if (recettesExtraites.length === 0) {
        setErreur("Aucune recette reconnue dans ce fichier.");
        setChargement(false);
        return;
      }

      const codesUniques = [
        ...new Set(recettesExtraites.flatMap((r) => r.lignes.map((l) => l.code))),
      ];
      const trouves = await rechercherArticlesParReferences(codesUniques);

      setRecettes(recettesExtraites);
      setCatalogue(catalogueExtrait);
      setArticlesParCode(new Map(trouves.map((t) => [t.reference, t])));
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

  function estPrete(recette: RecetteCoutsExtraite): boolean {
    return recette.lignes.every((l) => articlesParCode.has(l.code));
  }

  async function importerRecette(index: number) {
    const recette = recettes[index];
    if (!estPrete(recette)) return;

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
        lignes: recette.lignes.map((l) => {
          const article = articlesParCode.get(l.code)!;
          return {
            articleId: article.articleId,
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
      .filter((i) => estPrete(recettes[i]) && statuts[i] !== "importee");
    for (const index of indexPrets) {
      await importerRecette(index);
    }
    toast.success(`${indexPrets.length} recette(s) importée(s).`);
  }

  // Codes sans article correspondant, dédupliqués et triés par nombre de recettes qui les
  // utilisent : pour prioriser la création des articles manquants les plus utiles en premier.
  const codesManquants = (() => {
    const compte = new Map<string, { code: string; nom: string; nbRecettes: number }>();
    for (const recette of recettes) {
      const codesVus = new Set<string>();
      for (const ligne of recette.lignes) {
        if (articlesParCode.has(ligne.code) || codesVus.has(ligne.code)) continue;
        codesVus.add(ligne.code);
        const entree = compte.get(ligne.code);
        const nom = catalogue.get(ligne.code)?.denomination ?? ligne.nomFichier;
        if (entree) entree.nbRecettes += 1;
        else compte.set(ligne.code, { code: ligne.code, nom, nbRecettes: 1 });
      }
    }
    return [...compte.values()].sort((a, b) => b.nbRecettes - a.nbRecettes);
  })();

  const nbPretes = recettes.filter((r) => estPrete(r)).length;

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
            const prete = estPrete(recette);
            const statut = statuts[index] ?? "attente";
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
                        : `${recette.lignes.filter((l) => !articlesParCode.has(l.code)).length} ingrédient(s) sans code trouvé`}
                  </span>
                </div>

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
                  <ul style={{ fontSize: 13 }}>
                    {recette.lignes.map((ligne, i) => {
                      const article = articlesParCode.get(ligne.code);
                      return (
                        <li key={i} style={{ color: article ? undefined : "#b00020" }}>
                          {ligne.quantite} × {ligne.nomFichier} (code {ligne.code})
                          {article ? ` → ${article.nom}` : " → code introuvable"}
                        </li>
                      );
                    })}
                  </ul>
                </details>

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
