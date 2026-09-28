import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import FournisseursGrille from "../components/FournisseursGrille";
import SelecteurFournisseurHomonyme from "../components/SelecteurFournisseurHomonyme";
import FournisseurForm from "../components/FournisseurForm";
import { getFournisseurs, reactiverFournisseur, supprimerFournisseur } from "../services/fournisseurService";
import { regrouperFournisseursParNom, type GroupeFournisseur } from "../utils/regrouperFournisseurs";
import type { Fournisseur } from "../types/fournisseur";

export default function FournisseursPage() {
  const navigate = useNavigate();
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [fournisseurEnEdition, setFournisseurEnEdition] = useState<Fournisseur | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [groupeSelectionne, setGroupeSelectionne] = useState<GroupeFournisseur | null>(null);
  const [inclureInactifs, setInclureInactifs] = useState(false);

  async function chargerFournisseurs() {
    const data = await getFournisseurs({ inclureInactifs });
    setFournisseurs(data);
  }

  useEffect(() => {
    let annule = false;

    // Sans ce garde, une réponse plus lente pour l'état précédent (inclureInactifs=false) peut
    // arriver après celle du nouvel état et écraser silencieusement la liste avec des résultats
    // obsolètes — l'ordre de résolution des deux requêtes n'est jamais garanti.
    getFournisseurs({ inclureInactifs }).then((data) => {
      if (!annule) setFournisseurs(data);
    });

    return () => {
      annule = true;
    };
  }, [inclureInactifs]);

  // La désactivation (DELETE /:id, soft-delete) fait disparaître un fournisseur de la liste
  // active : les fournisseurs désactivés sont donc séparés ici, jamais mélangés au regroupement
  // par homonymie (regrouperFournisseursParNom, pensé pour des fournisseurs actifs uniquement) —
  // affichés dans leur propre section, avec pour seule action possible la réactivation.
  const fournisseursActifs = useMemo(
    () => fournisseurs.filter((fournisseur) => fournisseur.actif !== false),
    [fournisseurs]
  );
  const fournisseursInactifs = useMemo(
    () => fournisseurs.filter((fournisseur) => fournisseur.actif === false),
    [fournisseurs]
  );

  const fournisseursFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return fournisseursActifs;
    return fournisseursActifs.filter((fournisseur) => fournisseur.nom.toLowerCase().includes(terme));
  }, [fournisseursActifs, recherche]);

  const fournisseursInactifsFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return fournisseursInactifs;
    return fournisseursInactifs.filter((fournisseur) => fournisseur.nom.toLowerCase().includes(terme));
  }, [fournisseursInactifs, recherche]);

  const groupesFiltres = useMemo(
    () => regrouperFournisseursParNom(fournisseursFiltres),
    [fournisseursFiltres]
  );

  function ouvrirGroupe(groupe: GroupeFournisseur) {
    if (groupe.fournisseurs.length === 1) {
      navigate(`/fournisseurs/${groupe.fournisseurs[0].id}`);
      return;
    }
    setGroupeSelectionne(groupe);
  }

  function ouvrirCreation() {
    setFournisseurEnEdition(null);
    setFormulaireOuvert(true);
  }

  function ouvrirEdition(fournisseur: Fournisseur) {
    setFournisseurEnEdition(fournisseur);
    setFormulaireOuvert(true);
  }

  async function supprimer(fournisseur: Fournisseur) {
    const avertissement = fournisseur._count?.tarifs
      ? ` Il reste lié à ${fournisseur._count.tarifs} tarif(s) : il restera dans l'historique des prix mais n'apparaîtra plus dans cette liste.`
      : "";
    if (!confirm(`Supprimer le fournisseur "${fournisseur.nom}" ?${avertissement}`)) return;
    await supprimerFournisseur(fournisseur.id);
    chargerFournisseurs();
  }

  async function reactiver(fournisseur: Fournisseur) {
    if (!confirm(`Réactiver le fournisseur "${fournisseur.nom}" ?`)) return;
    await reactiverFournisseur(fournisseur.id);
    chargerFournisseurs();
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>🚚 Fournisseurs</h1>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <button className="btn-primary" onClick={ouvrirCreation}>+ Nouveau fournisseur</button>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--couleur-texte-attenue)" }}>
            <input
              type="checkbox"
              checked={inclureInactifs}
              onChange={(e) => setInclureInactifs(e.target.checked)}
            />
            Afficher aussi les fournisseurs désactivés
          </label>

          <input
            type="text"
            placeholder="Rechercher..."
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            style={{ width: 300, padding: 8 }}
          />
        </div>
      </div>

      <FournisseursGrille
        groupes={groupesFiltres}
        onOuvrir={ouvrirGroupe}
        onEdit={ouvrirEdition}
        onDelete={supprimer}
      />

      {inclureInactifs && fournisseursInactifsFiltres.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <h3 style={{ color: "var(--couleur-texte-attenue)" }}>Fournisseurs désactivés</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fournisseursInactifsFiltres.map((fournisseur) => (
              <div
                key={fournisseur.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "#f4f6f8",
                  borderRadius: "var(--rayon-petit)",
                }}
              >
                <div>
                  <strong>{fournisseur.nom}</strong>
                  {fournisseur.codeFournisseur && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: "var(--couleur-texte-attenue)" }}>
                      {fournisseur.codeFournisseur}
                    </span>
                  )}
                </div>
                <button className="btn-primary" onClick={() => reactiver(fournisseur)}>
                  Réactiver
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {groupeSelectionne && (
        <SelecteurFournisseurHomonyme
          nom={groupeSelectionne.nom}
          fournisseurs={groupeSelectionne.fournisseurs}
          onChoisir={(fournisseur) => {
            setGroupeSelectionne(null);
            navigate(`/fournisseurs/${fournisseur.id}`);
          }}
          onEdit={(fournisseur) => {
            setGroupeSelectionne(null);
            ouvrirEdition(fournisseur);
          }}
          onDelete={(fournisseur) => {
            setGroupeSelectionne(null);
            supprimer(fournisseur);
          }}
          onClose={() => setGroupeSelectionne(null)}
        />
      )}

      {formulaireOuvert && (
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
          }}
        >
          <FournisseurForm
            fournisseur={fournisseurEnEdition}
            onClose={() => setFormulaireOuvert(false)}
            onSave={chargerFournisseurs}
          />
        </div>
      )}
    </div>
  );
}
