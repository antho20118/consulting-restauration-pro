import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ajouterControle, getProduction } from "../services/productionService";
import type { ProductionDetail } from "../types/production";
import { suggestionsPourEtape } from "../utils/suggestionsControleHACCP";

type BrouillonControle = { valeur: string; conforme: boolean; commentaire: string };

const BROUILLON_VIDE: BrouillonControle = { valeur: "", conforme: true, commentaire: "" };

// Détail d'une production : pour chaque point critique HACCP de la recette (recalculé à chaque
// consultation, voir server/routes/productions.ts::etapesCritiquesDeLaRecette), l'historique des
// contrôles déjà enregistrés pour CETTE production précise, et un formulaire pour en ajouter un
// nouveau. Jamais de modification ni de suppression d'un contrôle existant une fois enregistré
// (aucune route ne le permet côté serveur) : une erreur de saisie se corrige en ajoutant un
// nouveau contrôle, jamais en réécrivant l'historique.
export default function ProductionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const productionId = Number(id);

  const [production, setProduction] = useState<ProductionDetail | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [brouillons, setBrouillons] = useState<Record<number, BrouillonControle>>({});
  const [enCours, setEnCours] = useState<number | null>(null);

  function charger() {
    getProduction(productionId)
      .then(setProduction)
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur inconnue"));
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionId]);

  function brouillon(etapeId: number): BrouillonControle {
    return brouillons[etapeId] ?? BROUILLON_VIDE;
  }

  function majBrouillon(etapeId: number, changement: Partial<BrouillonControle>) {
    setBrouillons((prec) => ({ ...prec, [etapeId]: { ...brouillon(etapeId), ...changement } }));
  }

  async function enregistrerControle(etapeId: number) {
    const saisie = brouillon(etapeId);
    if (!saisie.valeur.trim()) {
      toast.error("Indique la valeur constatée (ex. température, observation).");
      return;
    }
    setEnCours(etapeId);
    try {
      const misAJour = await ajouterControle(productionId, {
        recetteEtapeId: etapeId,
        valeur: saisie.valeur.trim(),
        conforme: saisie.conforme,
        commentaire: saisie.commentaire.trim() || undefined,
      });
      setProduction(misAJour);
      setBrouillons((prec) => ({ ...prec, [etapeId]: BROUILLON_VIDE }));
      toast.success("Contrôle enregistré.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible d'enregistrer ce contrôle");
    } finally {
      setEnCours(null);
    }
  }

  if (erreur) return <p style={{ padding: 20, color: "#b3261e" }}>{erreur}</p>;
  if (!production) return <p style={{ padding: 20 }}>Chargement…</p>;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <Link to="/productions">← Retour à la traçabilité HACCP</Link>
      </div>

      <h1>📋 {production.recette.nom}</h1>
      <p style={{ color: "var(--couleur-texte-attenue)" }}>
        Produit le {new Date(production.dateProduction).toLocaleString("fr-FR")}
        {" · "}
        {production.portionsProduites.toFixed(0)} portion(s) · {(production.poidsFiniProduitG / 1000).toFixed(2)} kg
        {production.depot && <> · dépôt {production.depot.nom}</>}
      </p>

      {production.etapesCritiques.length === 0 && (
        <p style={{ color: "#0ca30c" }}>✓ Cette recette n'a aucun point critique HACCP identifié.</p>
      )}

      {production.etapesCritiques.map((etape) => {
        const controlesEtape = production.controles
          .filter((c) => c.recetteEtapeId === etape.id)
          .sort((a, b) => new Date(b.dateHeure).getTime() - new Date(a.dateHeure).getTime());
        const saisie = brouillon(etape.id);
        const suggestions = suggestionsPourEtape(etape.reglesDetectees.map((r) => r.code));

        return (
          <div
            key={etape.id}
            style={{
              background: "#fff4e5",
              border: "1px solid #f0b429",
              borderRadius: 8,
              padding: "14px 18px",
              marginBottom: 16,
            }}
          >
            <h3 style={{ margin: "0 0 6px" }}>⚠ {etape.description}</h3>
            {etape.controleHACCP && (
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--couleur-texte-attenue)" }}>
                Procédure : {etape.controleHACCP}
              </p>
            )}
            {etape.reglesDetectees.length > 0 && (
              <div style={{ marginBottom: 10, fontSize: 13, color: "var(--couleur-texte-attenue)" }}>
                Détecté automatiquement : {etape.reglesDetectees.map((r) => r.nom).join(", ")}
              </div>
            )}

            {controlesEtape.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Contrôles enregistrés</div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  {controlesEtape.map((controle) => (
                    <li key={controle.id} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span style={{ color: controle.conforme ? "#1a7a3c" : "#b3261e", fontWeight: 600 }}>
                        {controle.conforme ? "✓ Conforme" : "✗ Non conforme"}
                      </span>
                      <span>{controle.valeur}</span>
                      {controle.commentaire && <span style={{ color: "var(--couleur-texte-attenue)" }}>— {controle.commentaire}</span>}
                      <span style={{ color: "var(--couleur-texte-attenue)", marginLeft: "auto" }}>
                        {new Date(controle.dateHeure).toLocaleString("fr-FR")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {suggestions.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.texte}
                    type="button"
                    className="btn-table"
                    onClick={() => majBrouillon(etape.id, { valeur: suggestion.texte, conforme: suggestion.conforme })}
                    style={{
                      color: suggestion.conforme ? "#1a7a3c" : "#b3261e",
                      borderColor: suggestion.conforme ? "#1a7a3c" : "#b3261e",
                    }}
                  >
                    {suggestion.conforme ? "✓" : "✗"} {suggestion.texte}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="text"
                placeholder="Valeur constatée (ex. 72°C)"
                value={saisie.valeur}
                onChange={(e) => majBrouillon(etape.id, { valeur: e.target.value })}
                style={{ padding: 8, flex: 1, minWidth: 160 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={saisie.conforme}
                  onChange={(e) => majBrouillon(etape.id, { conforme: e.target.checked })}
                />
                Conforme
              </label>
              <input
                type="text"
                placeholder="Commentaire (optionnel)"
                value={saisie.commentaire}
                onChange={(e) => majBrouillon(etape.id, { commentaire: e.target.value })}
                style={{ padding: 8, flex: 1, minWidth: 160 }}
              />
              <button
                className="btn-primary"
                onClick={() => enregistrerControle(etape.id)}
                disabled={enCours === etape.id}
              >
                {enCours === etape.id ? "Enregistrement…" : "Enregistrer le contrôle"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
