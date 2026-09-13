import { useEffect, useMemo, useState } from "react";
import MouvementsTable from "../components/MouvementsTable";
import MouvementForm from "../components/MouvementForm";
import { getMouvements } from "../services/mouvementService";
import type { MouvementStock } from "../types/mouvement";

export default function MouvementsPage() {
  const [mouvements, setMouvements] = useState<MouvementStock[]>([]);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");

  function chargerMouvements() {
    getMouvements().then(setMouvements);
  }

  useEffect(() => {
    chargerMouvements();
  }, []);

  const mouvementsFiltres = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return mouvements;
    return mouvements.filter((mouvement) => mouvement.article.nom.toLowerCase().includes(terme));
  }, [mouvements, recherche]);

  return (
    <div style={{ padding: 20 }}>
      <h1>📦 Mouvements de stock</h1>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <button onClick={() => setFormulaireOuvert(true)}>+ Nouveau mouvement</button>

        <input
          type="text"
          placeholder="Rechercher..."
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          style={{ width: 300, padding: 8 }}
        />
      </div>

      <MouvementsTable mouvements={mouvementsFiltres} />

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
          <MouvementForm
            onClose={() => setFormulaireOuvert(false)}
            onSave={chargerMouvements}
          />
        </div>
      )}
    </div>
  );
}
