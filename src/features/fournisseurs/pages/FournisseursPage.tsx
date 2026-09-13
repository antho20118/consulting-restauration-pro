import { useEffect, useMemo, useState } from "react";
import FournisseursTable from "../components/FournisseursTable";
import FournisseurForm from "../components/FournisseurForm";
import { getFournisseurs, supprimerFournisseur } from "../services/fournisseurService";
import type { Fournisseur } from "../types/fournisseur";

export default function FournisseursPage() {
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [fournisseurEnEdition, setFournisseurEnEdition] = useState<Fournisseur | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");

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

      <FournisseursTable
        fournisseurs={fournisseursFiltres}
        onEdit={ouvrirEdition}
        onDelete={supprimer}
      />

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
