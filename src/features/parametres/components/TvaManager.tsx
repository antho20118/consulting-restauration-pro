import toast from "react-hot-toast";
import { useEffect, useState } from "react";
import { creerTva, getTva, modifierTva, supprimerTva } from "../services/parametresService";
import type { Tva, TvaInput } from "../types/parametres";

const TVA_VIDE: TvaInput = { nom: "", taux: 0 };

export default function TvaManager() {
  const [tvas, setTvas] = useState<Tva[]>([]);
  const [edits, setEdits] = useState<Record<number, TvaInput>>({});
  const [nouvelle, setNouvelle] = useState<TvaInput>(TVA_VIDE);

  function chargerTva() {
    getTva().then((data) => {
      setTvas(data);
      setEdits(Object.fromEntries(data.map((t) => [t.id, { nom: t.nom, taux: t.taux }])));
    });
  }

  useEffect(() => {
    chargerTva();
  }, []);

  function modifierChamp(id: number, changement: Partial<TvaInput>) {
    setEdits((prec) => ({ ...prec, [id]: { ...prec[id], ...changement } }));
  }

  async function ajouter() {
    if (!nouvelle.nom.trim()) return;
    try {
      await creerTva(nouvelle);
      setNouvelle(TVA_VIDE);
      chargerTva();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function enregistrer(tva: Tva) {
    const input = edits[tva.id];
    if (!input) return;
    try {
      await modifierTva(tva.id, input);
      chargerTva();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function supprimer(tva: Tva) {
    if (!confirm(`Supprimer le taux "${tva.nom}" ?`)) return;
    try {
      await supprimerTva(tva.id);
      chargerTva();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  return (
    <div>
      {tvas.map((tva) => {
        const input = edits[tva.id] ?? TVA_VIDE;
        return (
          <div
            key={tva.id}
            style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
          >
            <input
              type="text"
              value={input.nom}
              onChange={(e) => modifierChamp(tva.id, { nom: e.target.value })}
              style={{ flex: 1, padding: 8 }}
            />
            <input
              type="number"
              step="0.1"
              value={input.taux}
              onChange={(e) => modifierChamp(tva.id, { taux: Number(e.target.value) })}
              style={{ width: 90, padding: 8 }}
            />
            <span style={{ color: "#898781" }}>%</span>
            <button className="btn-primary" onClick={() => enregistrer(tva)}>Enregistrer</button>
            <button className="btn-danger" onClick={() => supprimer(tva)}>Supprimer</button>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          type="text"
          placeholder="Nom (ex. TVA 10 %)"
          value={nouvelle.nom}
          onChange={(e) => setNouvelle((prec) => ({ ...prec, nom: e.target.value }))}
          style={{ flex: 1, padding: 8 }}
        />
        <input
          type="number"
          step="0.1"
          value={nouvelle.taux}
          onChange={(e) => setNouvelle((prec) => ({ ...prec, taux: Number(e.target.value) }))}
          style={{ width: 90, padding: 8 }}
        />
        <span style={{ color: "#898781" }}>%</span>
        <button className="btn-primary" onClick={ajouter}>Ajouter</button>
      </div>
    </div>
  );
}
