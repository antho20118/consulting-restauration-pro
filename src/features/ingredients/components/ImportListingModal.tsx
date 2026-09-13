import { useState } from "react";
import { API_URL } from "../../../config/api";
import { lireFichierImport } from "../../../common/importExcel";
import { importerListing, type ResultatImport } from "../services/importService";

type Categorie = { id: number; nom: string };
type Tva = { id: number; nom: string };

type Mapping = {
  designation: string;
  prix: string;
  conditionnement: string;
  reference: string;
  allergenes: string;
  categorie: string;
};

const MAPPING_VIDE: Mapping = {
  designation: "",
  prix: "",
  conditionnement: "",
  reference: "",
  allergenes: "",
  categorie: "",
};

const CHAMPS_A_MAPPER: { cle: keyof Mapping; label: string }[] = [
  { cle: "designation", label: "Désignation *" },
  { cle: "prix", label: "Prix *" },
  { cle: "conditionnement", label: "Conditionnement" },
  { cle: "reference", label: "Référence" },
  { cle: "allergenes", label: "Allergènes" },
  { cle: "categorie", label: "Catégorie" },
];

type Props = {
  onClose: () => void;
  onSave: () => void;
};

export default function ImportListingModal({ onClose, onSave }: Props) {
  const [etape, setEtape] = useState<1 | 2 | 3>(1);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  const [entetes, setEntetes] = useState<string[]>([]);
  const [lignesBrutes, setLignesBrutes] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>(MAPPING_VIDE);

  const [fournisseurNom, setFournisseurNom] = useState("");
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [categorieId, setCategorieId] = useState(0);
  const [tvas, setTvas] = useState<Tva[]>([]);
  const [tvaId, setTvaId] = useState(0);

  const [resultat, setResultat] = useState<ResultatImport | null>(null);

  async function chargerListesReference() {
    const [reponseCategories, reponseTva] = await Promise.all([
      fetch(`${API_URL}/categories`),
      fetch(`${API_URL}/tva`),
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
      setErreur("");
      await chargerListesReference();
      setEtape(2);
    } catch {
      setErreur("Impossible de lire ce fichier. Formats acceptés : .xlsx, .xls, .csv");
    }
  }

  async function confirmer() {
    if (!fournisseurNom.trim()) {
      setErreur("Indique le nom du fournisseur.");
      return;
    }
    if (!mapping.designation || !mapping.prix) {
      setErreur("Désignation et Prix sont obligatoires.");
      return;
    }

    const idxDesignation = entetes.indexOf(mapping.designation);
    const idxPrix = entetes.indexOf(mapping.prix);
    const idxCond = entetes.indexOf(mapping.conditionnement);
    const idxRef = entetes.indexOf(mapping.reference);
    const idxAllerg = entetes.indexOf(mapping.allergenes);
    const idxCategorie = entetes.indexOf(mapping.categorie);

    const lignes = lignesBrutes
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
        };
      })
      .filter((ligne): ligne is NonNullable<typeof ligne> => ligne !== null);

    if (lignes.length === 0) {
      setErreur("Aucune ligne exploitable trouvée avec ce mapping.");
      return;
    }

    setChargement(true);
    setErreur("");

    try {
      const reponse = await importerListing({
        societeId: 1,
        fournisseurNom,
        categorieId,
        tvaId,
        type: "MATIERE_PREMIERE",
        lignes,
      });
      setResultat(reponse);
      setEtape(3);
      onSave();
    } catch {
      setErreur("Impossible d'importer le listing.");
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
          <label>Nom du fournisseur</label>
          <input
            type="text"
            placeholder="ex. Metro, Pomona, Transgourmet…"
            value={fournisseurNom}
            onChange={(e) => setFournisseurNom(e.target.value)}
            style={{ width: "100%", padding: 10, marginBottom: 20 }}
          />

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

          {CHAMPS_A_MAPPER.map(({ cle, label }) => (
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

      {etape === 3 && resultat && (
        <div>
          <p>Import terminé :</p>
          <ul>
            <li>{resultat.crees} article(s) créé(s)</li>
            <li>{resultat.misesAJour} tarif(s) mis à jour</li>
            <li>{resultat.inchanges} article(s) déjà à jour</li>
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
        {etape !== 3 && <button onClick={onClose}>Annuler</button>}
        {etape === 2 && (
          <button onClick={confirmer} disabled={chargement}>
            {chargement ? "Import en cours…" : "Importer"}
          </button>
        )}
        {etape === 3 && <button onClick={onClose}>Fermer</button>}
      </div>
    </div>
  );
}
