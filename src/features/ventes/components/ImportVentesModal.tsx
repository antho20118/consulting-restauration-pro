import { useState } from "react";
import { lireFichierImport } from "../../../common/importExcel";
import {
  apercuVentes,
  importerVentes,
  type LigneVenteImport,
  type LigneVenteDecision,
  type PropositionLigneVente,
  type ResultatImportVentes,
} from "../services/venteService";

type Mapping = {
  designation: string;
  quantite: string;
  prixUnitaire: string;
};

const MAPPING_VIDE: Mapping = { designation: "", quantite: "", prixUnitaire: "" };

type Props = {
  onClose: () => void;
  onSave: () => void;
};

export default function ImportVentesModal({ onClose, onSave }: Props) {
  const [etape, setEtape] = useState<1 | 2 | 3 | 4>(1);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  const [entetes, setEntetes] = useState<string[]>([]);
  const [lignesBrutes, setLignesBrutes] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>(MAPPING_VIDE);
  const [fichierMeta, setFichierMeta] = useState<{ nom: string } | null>(null);
  const [periodeDebut, setPeriodeDebut] = useState("");
  const [periodeFin, setPeriodeFin] = useState("");

  const [lignes, setLignes] = useState<LigneVenteImport[]>([]);
  const [propositions, setPropositions] = useState<PropositionLigneVente[]>([]);
  // Recette retenue par ligne — préremplie pour les correspondances "certaine" (Alias/désignation
  // exacte), à confirmer explicitement pour une correspondance approximative ou à choisir parmi
  // plusieurs candidats : jamais une décision automatique, voir rapprochementVentes.ts.
  const [choix, setChoix] = useState<Record<number, number>>({});

  const [resultat, setResultat] = useState<ResultatImportVentes | null>(null);

  async function gererFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;

    try {
      const { entetes: entetesLues, lignes: lignesLues } = await lireFichierImport(fichier);
      setEntetes(entetesLues);
      setLignesBrutes(lignesLues);
      setMapping(MAPPING_VIDE);
      setFichierMeta({ nom: fichier.name });
      setErreur("");
      setEtape(2);
    } catch {
      setErreur("Impossible de lire ce fichier. Formats acceptés : .xlsx, .xls, .csv");
    }
  }

  function construireLignes(): LigneVenteImport[] | null {
    const idxDesignation = entetes.indexOf(mapping.designation);
    const idxQuantite = entetes.indexOf(mapping.quantite);
    const idxPrix = entetes.indexOf(mapping.prixUnitaire);

    const construites = lignesBrutes
      .map((ligne) => {
        const designation = String(ligne[idxDesignation] ?? "").trim();
        const quantite = String(ligne[idxQuantite] ?? "").trim();
        if (!designation || !quantite) return null;
        return {
          designation,
          quantite,
          prixUnitaire: idxPrix >= 0 ? String(ligne[idxPrix] ?? "").trim() : "",
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    return construites.length > 0 ? construites : null;
  }

  async function analyser() {
    if (!mapping.designation || !mapping.quantite) {
      setErreur("Désignation et Quantité vendue sont obligatoires.");
      return;
    }

    const lignesConstruites = construireLignes();
    if (!lignesConstruites) {
      setErreur("Aucune ligne exploitable trouvée avec ce mapping.");
      return;
    }

    setChargement(true);
    setErreur("");

    try {
      const { lignes: propositionsRecues } = await apercuVentes(lignesConstruites);
      setLignes(lignesConstruites);
      setPropositions(propositionsRecues);
      // Préremplissage des correspondances certaines (Alias/désignation exacte) — l'utilisateur
      // reste libre de décocher chaque ligne à l'étape suivante avant l'import.
      const prerempli: Record<number, number> = {};
      for (const proposition of propositionsRecues) {
        if (proposition.statut === "certaine") prerempli[proposition.index] = proposition.recetteProposeeId;
      }
      setChoix(prerempli);
      setEtape(3);
    } catch {
      setErreur("Impossible d'analyser ce fichier de ventes.");
    } finally {
      setChargement(false);
    }
  }

  function choisirRecette(index: number, recetteId: number | null) {
    setChoix((precedent) => {
      const suivant = { ...precedent };
      if (recetteId === null) delete suivant[index];
      else suivant[index] = recetteId;
      return suivant;
    });
  }

  // Étape 3 -> 4 : écriture réelle. Une ligne sans recette choisie explicitement est envoyée comme
  // REJETEE (jamais silencieusement omise) : le serveur réévalue et refuse tout choix qui ne
  // correspond plus exactement à la proposition réévaluée au moment de l'écriture.
  async function lancerImport() {
    setChargement(true);
    setErreur("");

    try {
      const lignesAvecDecision: LigneVenteDecision[] = lignes.map((ligne, index) => {
        const recetteRetenueId = choix[index];
        return recetteRetenueId !== undefined
          ? { ...ligne, decision: "VALIDEE", recetteRetenueId }
          : { ...ligne, decision: "REJETEE" };
      });

      const reponse = await importerVentes({
        nomFichierOriginal: fichierMeta?.nom,
        periodeDebut: periodeDebut || undefined,
        periodeFin: periodeFin || undefined,
        lignes: lignesAvecDecision,
      });
      setResultat(reponse);
      setEtape(4);
      onSave();
    } catch (error) {
      setErreur(error instanceof Error ? error.message : "Impossible d'importer ce fichier de ventes.");
    } finally {
      setChargement(false);
    }
  }

  return (
    <div
      style={{
        background: "white",
        padding: 20,
        borderRadius: 10,
        width: 560,
        maxWidth: "calc(100vw - 32px)",
        boxSizing: "border-box",
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "85vh",
        overflowY: "auto",
      }}
    >
      <h2>Importer des ventes</h2>

      {etape === 1 && (
        <div>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
            Sélectionne l'export CSV/Excel de ventes par produit de ta caisse enregistreuse ou de
            ton logiciel d'encaissement.
          </p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={gererFichier} />
        </div>
      )}

      {etape === 2 && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <label>Période — début (optionnel)</label>
              <input
                type="date"
                value={periodeDebut}
                onChange={(e) => setPeriodeDebut(e.target.value)}
                style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>Période — fin (optionnel)</label>
              <input
                type="date"
                value={periodeFin}
                onChange={(e) => setPeriodeFin(e.target.value)}
                style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            Fais correspondre les colonnes de ton fichier ({lignesBrutes.length} lignes détectées) :
          </div>

          {(
            [
              { cle: "designation", label: "Désignation du produit *" },
              { cle: "quantite", label: "Quantité vendue *" },
              { cle: "prixUnitaire", label: "Prix de vente unitaire (optionnel)" },
            ] as { cle: keyof Mapping; label: string }[]
          ).map(({ cle, label }) => (
            <div key={cle} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <label style={{ width: 200 }}>{label}</label>
              <select
                value={mapping[cle]}
                onChange={(e) => setMapping((m) => ({ ...m, [cle]: e.target.value }))}
                style={{ flex: 1, padding: 8 }}
              >
                <option value="">— aucune —</option>
                {entetes.map((entete, i) => (
                  <option key={i} value={entete}>
                    {entete || `Colonne ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {etape === 3 && (
        <div>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
            Vérifie chaque ligne avant import. Un produit vendu qui ne correspond à aucune recette
            suivie ici (boisson, à la carte non fichée…) reste ignoré — aucune recette n'est jamais
            créée automatiquement à partir d'un simple nom et d'un prix.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {propositions.map((proposition) => (
              <LignePropositionVente
                key={proposition.index}
                proposition={proposition}
                recetteChoisie={choix[proposition.index]}
                onChoisir={(recetteId) => choisirRecette(proposition.index, recetteId)}
              />
            ))}
          </div>
        </div>
      )}

      {etape === 4 && resultat && (
        <div>
          <p>Import terminé :</p>
          <ul>
            <li>{resultat.validees} vente(s) rapprochée(s) et enregistrée(s)</li>
            <li>{resultat.rejetees} ligne(s) ignorée(s)</li>
            {resultat.enAttente > 0 && <li>{resultat.enAttente} ligne(s) en attente</li>}
          </ul>
          {resultat.erreurs.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p style={{ color: "#b00020" }}>Remarques :</p>
              <ul style={{ color: "#b00020" }}>
                {resultat.erreurs.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {erreur && <div style={{ color: "#b00020", fontSize: 13, marginTop: 10 }}>{erreur}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
        {etape === 2 && (
          <button onClick={() => setEtape(1)} disabled={chargement}>
            Retour
          </button>
        )}
        {etape === 3 && (
          <button onClick={() => setEtape(2)} disabled={chargement}>
            Retour
          </button>
        )}
        {etape !== 4 && <button onClick={onClose}>Annuler</button>}
        {etape === 2 && (
          <button onClick={analyser} disabled={chargement}>
            {chargement ? "Analyse en cours…" : "Analyser"}
          </button>
        )}
        {etape === 3 && (
          <button onClick={lancerImport} disabled={chargement}>
            {chargement ? "Import en cours…" : "Lancer l'import"}
          </button>
        )}
        {etape === 4 && <button onClick={onClose}>Fermer</button>}
      </div>
    </div>
  );
}

const LIBELLE_MOTIF: Record<"ALIAS" | "DESIGNATION_EXACTE" | "DESIGNATION_APPROXIMATIVE", string> = {
  ALIAS: "Correspondance déjà confirmée précédemment",
  DESIGNATION_EXACTE: "Désignation identique au nom de la recette",
  DESIGNATION_APPROXIMATIVE: "Désignation proche (approximative)",
};

function LignePropositionVente({
  proposition,
  recetteChoisie,
  onChoisir,
}: {
  proposition: PropositionLigneVente;
  recetteChoisie: number | undefined;
  onChoisir: (recetteId: number | null) => void;
}) {
  const styleLigne = { border: "1px solid #ddd", borderRadius: 6, padding: "8px 10px", fontSize: 13 };

  if (proposition.statut === "invalide") {
    return (
      <div style={{ ...styleLigne, background: "#fdeeee" }}>
        <strong>⚠ {proposition.designationLue || "(désignation manquante)"}</strong>
        <div style={{ color: "#b00020", marginTop: 4 }}>Ignorée : {proposition.motif}</div>
      </div>
    );
  }

  if (proposition.statut === "aucun_candidat") {
    return (
      <div style={{ ...styleLigne, background: "#f4f4f4" }}>
        <strong>{proposition.designationLue}</strong>
        <div style={{ marginTop: 4, color: "#666" }}>
          Quantité vendue : {proposition.quantiteVendue} — aucune recette correspondante, ligne ignorée.
        </div>
      </div>
    );
  }

  if (proposition.statut === "plusieurs_candidats") {
    return (
      <div style={{ ...styleLigne, background: "#fff4e5" }}>
        <strong>{proposition.designationLue}</strong>
        <div style={{ marginTop: 4 }}>Quantité vendue : {proposition.quantiteVendue} — plusieurs recettes possibles :</div>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          {proposition.candidatsAlternatifs.map((candidat) => (
            <label key={candidat.recetteId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                name={`vente-${proposition.index}`}
                checked={recetteChoisie === candidat.recetteId}
                onChange={() => onChoisir(candidat.recetteId)}
              />
              {candidat.nom} (score {(candidat.score * 100).toFixed(0)}%)
            </label>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="radio"
              name={`vente-${proposition.index}`}
              checked={recetteChoisie === undefined}
              onChange={() => onChoisir(null)}
            />
            Ignorer cette ligne
          </label>
        </div>
      </div>
    );
  }

  // statut "certaine" ou "approximative_unique"
  const approximative = proposition.statut === "approximative_unique";
  return (
    <div style={{ ...styleLigne, background: approximative ? "#fff4e5" : "#eef7ee" }}>
      <strong>{proposition.designationLue}</strong>
      <div style={{ marginTop: 4 }}>
        Quantité vendue : {proposition.quantiteVendue} — recette proposée : «{" "}
        {proposition.recetteProposeeNom ?? "?"} » ({LIBELLE_MOTIF[proposition.motifCorrespondance]}
        {proposition.statut === "approximative_unique" ? `, score ${(proposition.confiance * 100).toFixed(0)}%` : ""})
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <input
          type="checkbox"
          checked={recetteChoisie === proposition.recetteProposeeId}
          onChange={(e) => onChoisir(e.target.checked ? proposition.recetteProposeeId : null)}
        />
        {approximative
          ? "Je confirme qu'il s'agit bien de cette recette"
          : "Inclure cette vente dans la réconciliation"}
      </label>
    </div>
  );
}
