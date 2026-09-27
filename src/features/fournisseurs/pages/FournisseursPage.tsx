import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import FournisseursGrille from "../components/FournisseursGrille";
import SelecteurFournisseurHomonyme from "../components/SelecteurFournisseurHomonyme";
import FournisseurForm from "../components/FournisseurForm";
import { getFournisseurs, supprimerFournisseur } from "../services/fournisseurService";
import { regrouperFournisseursParNom, type GroupeFournisseur } from "../utils/regrouperFournisseurs";
import type { Fournisseur } from "../types/fournisseur";

export default function FournisseursPage() {
  const navigate = useNavigate();
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [fournisseurEnEdition, setFournisseurEnEdition] = useState<Fournisseur | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [groupeSelectionne, setGroupeSelectionne] = useState<GroupeFournisseur | null>(null);

  async function chargerFournisseurs() {
    const data = await getFournisseurs();
    setFournisseurs(data);
  }

  useEffect(() => {
    getFournisseurs().then(setFournisseurs);
  }, []);

  const fournisseursFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return fournisseurs;
    return fournisseurs.filter((fournisseur) => fournisseur.nom.toLowerCase().includes(terme));
  }, [fournisseurs, recherche]);

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

  return (
    <div style={{ padding: 20 }}>
      <h1>🚚 Fournisseurs</h1>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <button className="btn-primary" onClick={ouvrirCreation}>+ Nouveau fournisseur</button>

        <input
          type="text"
          placeholder="Rechercher..."
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          style={{ width: 300, padding: 8 }}
        />
      </div>

      <FournisseursGrille
        groupes={groupesFiltres}
        onOuvrir={ouvrirGroupe}
        onEdit={ouvrirEdition}
        onDelete={supprimer}
      />

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
