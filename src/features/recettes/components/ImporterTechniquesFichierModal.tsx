import { useState } from "react";
import toast from "react-hot-toast";
import { getRecettes, modifierRecette } from "../services/recetteService";
import {
  analyserFichierTechniques,
  trouverRecetteCorrespondante,
  type RecetteTechniqueExtraite,
} from "../utils/analyserFichierTechniques";
import type { Recette } from "../types/recette";

type Props = {
  onClose: () => void;
  onImporte: () => void;
};

type StatutRecette = "attente" | "en_cours" | "ajoutee" | "erreur";

export default function ImporterTechniquesFichierModal({ onClose, onImporte }: Props) {
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  const [recettesTechniques, setRecettesTechniques] = useState<RecetteTechniqueExtraite[]>([]);
  const [recettesExistantes, setRecettesExistantes] = useState<Recette[]>([]);
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
      setRecettesExistantes(recettesData);

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
    const existante = recettesExistantes.find((r) => r.id === recetteId);
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
      <h2 style={{ marginTop: 0 }}>Importer des techniques (fichier)</h2>

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
                    {recettesExistantes.map((r) => (
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

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
        <button onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
