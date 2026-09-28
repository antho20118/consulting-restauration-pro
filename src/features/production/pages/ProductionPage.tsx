import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import RecettesGrille from "../../recettes/components/RecettesGrille";
import { getRecettes } from "../../recettes/services/recetteService";
import { normaliserTexte } from "../../recettes/utils/normaliserTexte";
import type { Recette } from "../../recettes/types/recette";

// Écran « PRODUIRE » (voir cadrage : séparer consultation de fiche et planification de
// production) : choix de la recette à produire, puis navigation vers l'écran de planification
// dédié (/production/:id) — jamais un calculateur réouvert dans la fiche recette elle-même.
export default function ProductionPage() {
  const [recettes, setRecettes] = useState<Recette[]>([]);
  const [recherche, setRecherche] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    getRecettes().then(setRecettes);
  }, []);

  const recettesFiltrees = useMemo(() => {
    const terme = normaliserTexte(recherche);
    if (!terme) return recettes;
    return recettes.filter((recette) => normaliserTexte(recette.nom).includes(terme));
  }, [recettes, recherche]);

  return (
    <div style={{ padding: 20 }}>
      <h1>🏭 Production</h1>
      <p style={{ color: "var(--couleur-texte-attenue)", marginTop: -8, marginBottom: 20 }}>
        Choisis une recette pour planifier une production : quantités d'ingrédients, besoins nets
        après stock, et proposition d'achat au conditionnement fournisseur.
      </p>

      <input
        type="text"
        placeholder="Rechercher une recette..."
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        style={{ width: 300, padding: 8, marginBottom: 20 }}
      />

      <RecettesGrille recettes={recettesFiltrees} onOuvrir={(recette) => navigate(`/production/${recette.id}`)} />
    </div>
  );
}
