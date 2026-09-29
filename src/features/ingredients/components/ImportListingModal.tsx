import { useState } from "react";
import { API_URL, apiFetch } from "../../../config/api";
import { lireFichierImport } from "../../../common/importExcel";
import {
  apercuListing,
  importerListing,
  type LigneImport,
  type PropositionLigneImport,
  type ResultatImport,
} from "../services/importService";

type Categorie = { id: number; nom: string };
type Tva = { id: number; nom: string };

type Mapping = {
  designation: string;
  prix: string;
  conditionnement: string;
  reference: string;
  allergenes: string;
  categorie: string;
  fournisseur: string;
  // Identité stable (voir cadrage « identité fournisseur + produit fournisseur ») : colonnes
  // optionnelles, priment sur fournisseur/reference ci-dessus quand mappées. Un fichier qui ne les
  // mappe pas continue de fonctionner exactement comme avant (rapprochement historique).
  codeFournisseur: string;
  codeProduitFournisseur: string;
};

const MAPPING_VIDE: Mapping = {
  designation: "",
  prix: "",
  conditionnement: "",
  reference: "",
  allergenes: "",
  categorie: "",
  fournisseur: "",
  codeFournisseur: "",
  codeProduitFournisseur: "",
};

const CHAMPS_A_MAPPER: { cle: keyof Mapping; label: string }[] = [
  { cle: "designation", label: "Désignation *" },
  { cle: "prix", label: "Prix *" },
  { cle: "conditionnement", label: "Conditionnement" },
  { cle: "reference", label: "Référence" },
  { cle: "allergenes", label: "Allergènes" },
  { cle: "categorie", label: "Catégorie" },
  { cle: "fournisseur", label: "Fournisseur (si plusieurs dans le fichier)" },
  { cle: "codeFournisseur", label: "Code fournisseur (identité stable, optionnel)" },
  { cle: "codeProduitFournisseur", label: "Code produit fournisseur (optionnel)" },
];

// Sans fournisseur imposé par le contexte : tous les champs, comportement historique inchangé.
// Avec fournisseur imposé (fiche fournisseur → Listings → Importer) : "fournisseur" et
// "codeFournisseur" n'ont plus aucun effet côté serveur (voir cadrage §10, articles.ts) — les
// proposer resterait trompeur, ils sont donc retirés du mapping affiché. "codeProduitFournisseur"
// devient en revanche obligatoire dans ce contexte (voir cadrage « identification des articles » :
// le serveur refuse toute ligne sans code produit fournisseur pour un import de fiche fournisseur)
// — le libellé doit le dire explicitement, sinon "optionnel" induit l'utilisateur en erreur.
const CHAMPS_A_MAPPER_SANS_FOURNISSEUR = CHAMPS_A_MAPPER.filter(
  ({ cle }) => cle !== "fournisseur" && cle !== "codeFournisseur"
).map(({ cle, label }) =>
  cle === "codeProduitFournisseur"
    ? { cle, label: "Code produit fournisseur * (obligatoire pour cet import)" }
    : { cle, label }
);

type Props = {
  // Fournisseur imposé par le contexte de navigation (fiche fournisseur → onglet Listings →
  // Importer, voir cadrage « déplacement de l'import listing ») : quand fourni, aucune saisie ni
  // colonne fournisseur/codeFournisseur n'est proposée dans ce modal — une seule source de vérité.
  // Absent (import générique, hors de ce chantier), le comportement historique est inchangé.
  fournisseurId?: number;
  fournisseurNom?: string;
  onClose: () => void;
  onSave: () => void;
};

export default function ImportListingModal({ fournisseurId, fournisseurNom: fournisseurNomContexte, onClose, onSave }: Props) {
  const [etape, setEtape] = useState<1 | 2 | 3 | 4>(1);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  const [entetes, setEntetes] = useState<string[]>([]);
  const [lignesBrutes, setLignesBrutes] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>(MAPPING_VIDE);
  // Métadonnées du fichier source (nom/type MIME/taille), jamais inventées : reprises du File
  // choisi à l'étape 1, transmises telles quelles pour l'historique de l'import (Phase 6, voir
  // DocumentFournisseur côté serveur).
  const [fichierMeta, setFichierMeta] = useState<{ nom: string; type: string; taille: number } | null>(null);

  const [fournisseurNom, setFournisseurNom] = useState(fournisseurNomContexte ?? "");
  const champsAMapper = fournisseurId !== undefined ? CHAMPS_A_MAPPER_SANS_FOURNISSEUR : CHAMPS_A_MAPPER;
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [categorieId, setCategorieId] = useState(0);
  const [tvas, setTvas] = useState<Tva[]>([]);
  const [tvaId, setTvaId] = useState(0);

  // Lignes mappées à l'étape 2 (une seule fois), réutilisées telles quelles pour l'aperçu (étape 3)
  // et pour l'import final (étape 3 -> 4), afin que la proposition affichée et confirmée par
  // l'utilisateur porte exactement sur les mêmes lignes que celles envoyées à l'écriture.
  const [lignes, setLignes] = useState<LigneImport[]>([]);
  const [propositions, setPropositions] = useState<PropositionLigneImport[]>([]);
  // Index de ligne -> articleId confirmé par l'utilisateur pour une correspondance approximative
  // (voir PropositionLigneImport, statut "tarif_a_remplacer" + typeCorrespondance "approximative") :
  // jamais un simple booléen, toujours l'articleId précis de la proposition affichée, pour que le
  // serveur puisse vérifier que la confirmation porte bien sur la correspondance réévaluée au
  // moment de l'écriture (voir importService.ts, POST /articles/import).
  const [confirmations, setConfirmations] = useState<Record<number, number>>({});

  const [resultat, setResultat] = useState<ResultatImport | null>(null);

  async function chargerListesReference() {
    const [reponseCategories, reponseTva] = await Promise.all([
      apiFetch(`${API_URL}/categories`),
      apiFetch(`${API_URL}/tva`),
    ]);
    const donneesCategories = await reponseCategories.json();
    const donneesTva = await reponseTva.json();
    setCategories(donneesCategories);
    setTvas(donneesTva);
    if (donneesCategories.length > 0) setCategorieId(donneesCategories[0].id);
    if (donneesTva.length > 0) setTvaId(donneesTva[0].id);
  }

  async function gererFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;

    try {
      const { entetes: entetesLues, lignes } = await lireFichierImport(fichier);
      setEntetes(entetesLues);
      setLignesBrutes(lignes);
      setMapping(MAPPING_VIDE);
      setFichierMeta({ nom: fichier.name, type: fichier.type, taille: fichier.size });
      setErreur("");
      await chargerListesReference();
      setEtape(2);
    } catch {
      setErreur("Impossible de lire ce fichier. Formats acceptés : .xlsx, .xls, .csv");
    }
  }

  // Construit la liste des lignes exploitables à partir du mapping choisi (étape 2), commune à
  // l'aperçu et à l'import final.
  function construireLignes(): LigneImport[] | null {
    const idxDesignation = entetes.indexOf(mapping.designation);
    const idxPrix = entetes.indexOf(mapping.prix);
    const idxCond = entetes.indexOf(mapping.conditionnement);
    const idxRef = entetes.indexOf(mapping.reference);
    const idxAllerg = entetes.indexOf(mapping.allergenes);
    const idxCategorie = entetes.indexOf(mapping.categorie);
    const idxFournisseur = entetes.indexOf(mapping.fournisseur);
    const idxCodeFournisseur = entetes.indexOf(mapping.codeFournisseur);
    const idxCodeProduit = entetes.indexOf(mapping.codeProduitFournisseur);

    const lignesConstruites = lignesBrutes
      .map((ligne) => {
        const designation = String(ligne[idxDesignation] ?? "").trim();
        const prix = String(ligne[idxPrix] ?? "").trim();
        if (!designation || !prix) return null;

        return {
          designation,
          prix,
          conditionnement: idxCond >= 0 ? String(ligne[idxCond] ?? "").trim() : "",
          reference: idxRef >= 0 ? String(ligne[idxRef] ?? "").trim() : "",
          allergenes: idxAllerg >= 0 ? String(ligne[idxAllerg] ?? "").trim() : "",
          categorie: idxCategorie >= 0 ? String(ligne[idxCategorie] ?? "").trim() : "",
          fournisseur: idxFournisseur >= 0 ? String(ligne[idxFournisseur] ?? "").trim() : "",
          codeFournisseur: idxCodeFournisseur >= 0 ? String(ligne[idxCodeFournisseur] ?? "").trim() : "",
          codeProduitFournisseur: idxCodeProduit >= 0 ? String(ligne[idxCodeProduit] ?? "").trim() : "",
        };
      })
      .filter((ligne): ligne is NonNullable<typeof ligne> => ligne !== null);

    return lignesConstruites.length > 0 ? lignesConstruites : null;
  }

  // Étape 2 -> 3 : analyse en lecture seule (voir POST /articles/import/apercu), jamais d'écriture.
  // Chaque ligne doit être explicitement examinée avant import, y compris les correspondances par
  // référence ou les créations, pour qu'aucune correspondance approximative ne puisse être écrite
  // sans être d'abord passée sous les yeux de l'utilisateur.
  async function analyser() {
    if (fournisseurId === undefined && !fournisseurNom.trim() && !mapping.fournisseur) {
      setErreur("Indique le nom du fournisseur, ou mappe une colonne Fournisseur.");
      return;
    }
    if (!mapping.designation || !mapping.prix) {
      setErreur("Désignation et Prix sont obligatoires.");
      return;
    }
    // Import lancé depuis la fiche fournisseur : le serveur refuse de toute façon toute ligne sans
    // code produit fournisseur (voir cadrage « identification des articles »), mais bloquer ici
    // évite à l'utilisateur de lancer une analyse pour ne découvrir le rejet qu'à l'étape suivante.
    if (fournisseurId !== undefined && !mapping.codeProduitFournisseur) {
      setErreur(
        "Le code produit fournisseur est obligatoire pour un import depuis la fiche fournisseur : " +
        "mappe la colonne correspondante avant de lancer l'analyse."
      );
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
      const { propositions: propositionsRecues } = await apercuListing({
        societeId: 1,
        fournisseurNom,
        fournisseurId,
        lignes: lignesConstruites,
      });
      setLignes(lignesConstruites);
      setPropositions(propositionsRecues);
      setConfirmations({});
      setEtape(3);
    } catch {
      setErreur("Impossible d'analyser le listing.");
    } finally {
      setChargement(false);
    }
  }

  function basculerConfirmation(index: number, articleId: number, confirmee: boolean) {
    setConfirmations((precedent) => {
      const suivant = { ...precedent };
      if (confirmee) {
        suivant[index] = articleId;
      } else {
        delete suivant[index];
      }
      return suivant;
    });
  }

  // Étape 3 -> 4 : écriture réelle. Chaque ligne à correspondance approximative ne porte une
  // confirmationArticleId que si l'utilisateur a explicitement coché cette ligne précise ; le
  // serveur réévalue et refuse toute correspondance approximative non confirmée (voir PR #79).
  async function lancerImport() {
    setChargement(true);
    setErreur("");

    try {
      const lignesAvecConfirmation = lignes.map((ligne, index) => {
        const articleIdConfirme = confirmations[index];
        return articleIdConfirme !== undefined
          ? { ...ligne, confirmationArticleId: articleIdConfirme }
          : ligne;
      });

      const reponse = await importerListing({
        societeId: 1,
        fournisseurNom,
        fournisseurId,
        categorieId,
        tvaId,
        type: "MATIERE_PREMIERE",
        lignes: lignesAvecConfirmation,
        nomFichierOriginal: fichierMeta?.nom,
        typeMime: fichierMeta?.type,
        tailleOctets: fichierMeta?.taille,
      });
      setResultat(reponse);
      setEtape(4);
      onSave();
    } catch (error) {
      // Une ambiguïté fournisseur (409) porte un message explicite (voir importService.ts) —
      // jamais remplacé par le message générique quand il est disponible.
      setErreur(error instanceof Error ? error.message : "Impossible d'importer le listing.");
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
        width: 500,
        maxWidth: "calc(100vw - 32px)",
        boxSizing: "border-box",
        boxShadow: "0 0 20px rgba(0,0,0,.2)",
        maxHeight: "85vh",
        overflowY: "auto",
      }}
    >
      <h2>Importer un listing fournisseur</h2>

      {etape === 1 && (
        <div>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
            Sélectionne le fichier Excel ou CSV envoyé par ton fournisseur.
          </p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={gererFichier} />
        </div>
      )}

      {etape === 2 && (
        <div>
          {fournisseurId !== undefined ? (
            <div
              style={{
                background: "#eafaf4",
                border: "1px solid #bfe6d6",
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 20,
                fontSize: 13,
                color: "#0f6848",
              }}
            >
              Ce listing sera importé pour <strong>{fournisseurNomContexte || "ce fournisseur"}</strong>.
            </div>
          ) : (
            <>
              <label>Nom du fournisseur (par défaut, si la colonne Fournisseur n'est pas mappée ou vide sur une ligne)</label>
              <input
                type="text"
                placeholder="ex. Metro, Pomona, Transgourmet…"
                value={fournisseurNom}
                onChange={(e) => setFournisseurNom(e.target.value)}
                style={{ width: "100%", padding: 10, marginBottom: 20 }}
              />
            </>
          )}

          <label>Catégorie par défaut (si la colonne "Catégorie" n'est pas mappée ou vide)</label>
          <select
            value={categorieId}
            onChange={(e) => setCategorieId(Number(e.target.value))}
            style={{ width: "100%", padding: 10, marginBottom: 20 }}
          >
            {categories.map((categorie) => (
              <option key={categorie.id} value={categorie.id}>
                {categorie.nom}
              </option>
            ))}
          </select>

          <label>TVA des nouveaux articles</label>
          <select
            value={tvaId}
            onChange={(e) => setTvaId(Number(e.target.value))}
            style={{ width: "100%", padding: 10, marginBottom: 20 }}
          >
            {tvas.map((tva) => (
              <option key={tva.id} value={tva.id}>
                {tva.nom}
              </option>
            ))}
          </select>

          <div style={{ marginBottom: 8 }}>
            Fais correspondre les colonnes de ton fichier ({lignesBrutes.length} lignes détectées) :
          </div>

          {champsAMapper.map(({ cle, label }) => (
            <div
              key={cle}
              style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}
            >
              <label style={{ width: 140 }}>{label}</label>
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
            Vérifie chaque ligne avant import. Une correspondance approximative (désignation
            proche, sans référence identique) ne modifiera le tarif existant que si tu la
            confirmes explicitement ci-dessous.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {propositions.map((proposition, index) => (
              <LignePropositionImport
                key={index}
                proposition={proposition}
                confirmee={confirmations[index] !== undefined}
                onConfirmerChange={(confirmee) => {
                  if (proposition.statut === "tarif_a_remplacer") {
                    basculerConfirmation(index, proposition.articleId, confirmee);
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {etape === 4 && resultat && (
        <div>
          <p>Import terminé :</p>
          <ul>
            <li>{resultat.crees} article(s) créé(s)</li>
            <li>{resultat.misesAJour} tarif(s) mis à jour</li>
            <li>{resultat.inchanges} article(s) déjà à jour</li>
            {resultat.enAttente > 0 && (
              <li>{resultat.enAttente} correspondance(s) approximative(s) non confirmée(s), non écrite(s)</li>
            )}
          </ul>
          {resultat.erreurs.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p style={{ color: "#b00020" }}>Lignes ignorées :</p>
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

const LIBELLE_TYPE_CORRESPONDANCE: Record<"reference" | "approximative", string> = {
  reference: "Référence identique",
  approximative: "Désignation proche (approximative)",
};

function LignePropositionImport({
  proposition,
  confirmee,
  onConfirmerChange,
}: {
  proposition: PropositionLigneImport;
  confirmee: boolean;
  onConfirmerChange: (confirmee: boolean) => void;
}) {
  const styleLigne = {
    border: "1px solid #ddd",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 13,
  };

  if (proposition.statut === "invalide") {
    return (
      <div style={{ ...styleLigne, background: "#fdeeee" }}>
        <strong>⚠ {proposition.designation || "(désignation manquante)"}</strong>
        <div style={{ color: "#b00020", marginTop: 4 }}>Ignorée : {proposition.motif}</div>
      </div>
    );
  }

  if (proposition.statut === "fournisseur_ambigu") {
    return (
      <div style={{ ...styleLigne, background: "#fdeeee" }}>
        <strong>⚠ {proposition.designation || "(désignation manquante)"}</strong>
        <div style={{ color: "#b00020", marginTop: 4 }}>
          Plusieurs fournisseurs existants correspondent au nom « {proposition.nom} » : cette ligne
          sera ignorée à l'import. Résous l'ambiguïté sur les fiches fournisseurs avant de
          réimporter.
        </div>
      </div>
    );
  }

  if (proposition.statut === "fournisseur_inactif") {
    return (
      <div style={{ ...styleLigne, background: "#fdeeee" }}>
        <strong>⚠ {proposition.designation || "(désignation manquante)"}</strong>
        <div style={{ color: "#b00020", marginTop: 4 }}>
          Le fournisseur « {proposition.identifiant} » existe mais est inactif : cette ligne sera
          ignorée à l'import. Réactive-le explicitement (fiche fournisseur) avant de réimporter.
        </div>
      </div>
    );
  }

  if (proposition.statut === "code_produit_designation_differente") {
    return (
      <div style={{ ...styleLigne, background: "#fff8e1" }}>
        <strong>⚠ {proposition.designation || "(désignation manquante)"}</strong>
        <div style={{ color: "#8a6d00", marginTop: 4 }}>
          Le code produit « {proposition.codeProduitFournisseur} » est déjà connu chez ce fournisseur
          avec une désignation très différente (« {proposition.designationConnue} ») : cette ligne
          sera ignorée à l'import tant qu'une décision humaine n'a pas confirmé qu'il s'agit bien du
          même produit.
        </div>
      </div>
    );
  }

  if (proposition.statut === "code_produit_manquant") {
    return (
      <div style={{ ...styleLigne, background: "#fdeeee" }}>
        <strong>⚠ {proposition.designation || "(désignation manquante)"}</strong>
        <div style={{ color: "#b00020", marginTop: 4 }}>
          Code produit fournisseur manquant : cette ligne sera ignorée à l'import. Un code produit
          est obligatoire pour un import depuis la fiche fournisseur, afin d'éviter la création d'un
          article en double à chaque réimport.
        </div>
      </div>
    );
  }

  if (proposition.statut === "creation") {
    return (
      <div style={styleLigne}>
        <strong>{proposition.designation}</strong>
        <div style={{ marginTop: 4 }}>
          Nouvel article — {proposition.fournisseurNom || "fournisseur non renseigné"} —{" "}
          {proposition.prixHT.toFixed(4)} € HT / {proposition.uniteSymbole}
        </div>
      </div>
    );
  }

  if (proposition.statut === "tarif_inchange") {
    return (
      <div style={{ ...styleLigne, background: "#f4f4f4" }}>
        <strong>{proposition.designation}</strong>
        <div style={{ marginTop: 4 }}>
          Correspond à « {proposition.articleNom} » ({LIBELLE_TYPE_CORRESPONDANCE[proposition.typeCorrespondance]}
          {proposition.score !== null ? `, score ${(proposition.score * 100).toFixed(0)}%` : ""}) — tarif déjà à
          jour, aucune écriture.
        </div>
      </div>
    );
  }

  // proposition.statut === "tarif_a_remplacer"
  const approximative = proposition.typeCorrespondance === "approximative";

  return (
    <div style={{ ...styleLigne, background: approximative ? "#fff4e5" : "#eef7ee" }}>
      <strong>{proposition.designation}</strong>
      <div style={{ marginTop: 4 }}>
        Article correspondant : « {proposition.articleNom} » —{" "}
        {LIBELLE_TYPE_CORRESPONDANCE[proposition.typeCorrespondance]}
        {proposition.score !== null ? `, score ${(proposition.score * 100).toFixed(0)}%` : ""}
      </div>
      <div style={{ marginTop: 4 }}>
        Fournisseur : {proposition.fournisseurNom || "non renseigné"} — Ancien prix :{" "}
        {proposition.ancienPrixHT !== null ? `${proposition.ancienPrixHT.toFixed(4)} €` : "aucun"} → Nouveau prix :{" "}
        {proposition.nouveauPrixHT.toFixed(4)} € HT / {proposition.uniteSymbole}
      </div>
      {approximative ? (
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <input
            type="checkbox"
            checked={confirmee}
            onChange={(e) => onConfirmerChange(e.target.checked)}
          />
          Je confirme que « {proposition.articleNom} » est bien le même article et que son tarif doit être remplacé
        </label>
      ) : (
        <div style={{ marginTop: 6, color: "#2e7d32" }}>
          Correspondance par référence : le tarif sera mis à jour automatiquement.
        </div>
      )}
    </div>
  );
}
