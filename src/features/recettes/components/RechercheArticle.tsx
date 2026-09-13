import { useEffect, useRef, useState } from "react";
import type { ArticleRecette } from "../types/recette";

// Un <select> listant des milliers d'articles (après un import fournisseur volumineux) est
// inutilisable : on lui préfère un champ de recherche qui filtre la liste au fil de la frappe et
// n'affiche qu'un nombre limité de résultats.
type Props = {
  articles: ArticleRecette[];
  articleId: number;
  onChange: (articleId: number) => void;
};

const MAX_RESULTATS = 50;

export default function RechercheArticle({ articles, articleId, onChange }: Props) {
  const articleSelectionne = articles.find((a) => a.id === articleId);
  const [recherche, setRecherche] = useState(articleSelectionne?.nom ?? "");
  const [ouvert, setOuvert] = useState(false);
  const [dernierArticleId, setDernierArticleId] = useState(articleId);
  const [dernierNomResolu, setDernierNomResolu] = useState(articleSelectionne?.nom);
  const conteneurRef = useRef<HTMLDivElement>(null);

  // Resynchronise le texte affiché quand la sélection change depuis l'extérieur (ex. un article
  // par défaut assigné à une nouvelle ligne), ou quand le nom vient d'être résolu après coup pour
  // le même articleId (la liste des articles arrive après coup, par un fetch asynchrone : au
  // premier rendu d'une recette existante ou d'un brouillon importé, articles est encore vide et
  // articleSelectionne indéfini bien que articleId soit déjà connu) — ajustement pendant le rendu
  // plutôt que dans un effet.
  if (articleId !== dernierArticleId || articleSelectionne?.nom !== dernierNomResolu) {
    setDernierArticleId(articleId);
    setDernierNomResolu(articleSelectionne?.nom);
    setRecherche(articleSelectionne?.nom ?? "");
  }

  useEffect(() => {
    function gererClicExterieur(e: MouseEvent) {
      if (conteneurRef.current && !conteneurRef.current.contains(e.target as Node)) {
        setOuvert(false);
        setRecherche(articleSelectionne?.nom ?? "");
      }
    }
    document.addEventListener("mousedown", gererClicExterieur);
    return () => document.removeEventListener("mousedown", gererClicExterieur);
  }, [articleSelectionne]);

  const terme = recherche.trim().toLowerCase();
  const resultats = (
    terme ? articles.filter((a) => a.nom.toLowerCase().includes(terme)) : articles
  ).slice(0, MAX_RESULTATS);

  return (
    <div ref={conteneurRef} style={{ position: "relative", flex: 2 }}>
      <input
        type="text"
        value={recherche}
        onFocus={() => setOuvert(true)}
        onChange={(e) => {
          setRecherche(e.target.value);
          setOuvert(true);
        }}
        placeholder="Rechercher un article…"
        style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
      />
      {ouvert && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            background: "white",
            border: "1px solid #ccc",
            borderRadius: 4,
            maxHeight: 220,
            overflowY: "auto",
            boxShadow: "0 4px 10px rgba(0,0,0,.15)",
          }}
        >
          {resultats.length === 0 && (
            <div style={{ padding: 8, color: "#888" }}>Aucun résultat</div>
          )}
          {resultats.map((a) => (
            <div
              key={a.id}
              onClick={() => {
                onChange(a.id);
                setRecherche(a.nom);
                setOuvert(false);
              }}
              style={{ padding: 8, cursor: "pointer" }}
            >
              {a.nom}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
