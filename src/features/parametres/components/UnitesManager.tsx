import toast from "react-hot-toast";
import { useEffect, useState } from "react";
import {
  creerUnite,
  getUnites,
  modifierUnite,
  supprimerUnite,
} from "../services/parametresService";
import type { Unite, UniteInput } from "../types/parametres";

const TYPES_UNITE = ["poids", "volume", "unite"];

const UNITE_VIDE: UniteInput = { nom: "", symbole: "", type: "poids", facteurBase: 1 };

export default function UnitesManager() {
  const [unites, setUnites] = useState<Unite[]>([]);
  const [edits, setEdits] = useState<Record<number, UniteInput>>({});
  const [nouvelle, setNouvelle] = useState<UniteInput>(UNITE_VIDE);

  function chargerUnites() {
    getUnites().then((data) => {
      setUnites(data);
      setEdits(
        Object.fromEntries(
          data.map((u) => [
            u.id,
            { nom: u.nom, symbole: u.symbole, type: u.type, facteurBase: u.facteurBase },
          ])
        )
      );
    });
  }

  useEffect(() => {
    chargerUnites();
  }, []);

  function modifierChamp(id: number, changement: Partial<UniteInput>) {
    setEdits((prec) => ({ ...prec, [id]: { ...prec[id], ...changement } }));
  }

  async function ajouter() {
    if (!nouvelle.nom.trim() || !nouvelle.symbole.trim()) return;
    try {
      await creerUnite(nouvelle);
      setNouvelle(UNITE_VIDE);
      chargerUnites();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function enregistrer(unite: Unite) {
    const input = edits[unite.id];
    if (!input) return;
    try {
      await modifierUnite(unite.id, input);
      chargerUnites();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function supprimer(unite: Unite) {
    if (!confirm(`Supprimer l'unité "${unite.nom}" ?`)) return;
    try {
      await supprimerUnite(unite.id);
      chargerUnites();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  return (
    <div>
      {unites.map((unite) => {
        const input = edits[unite.id] ?? UNITE_VIDE;
        return (
          <div
            key={unite.id}
            style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
          >
            <input
              type="text"
              value={input.nom}
              onChange={(e) => modifierChamp(unite.id, { nom: e.target.value })}
              style={{ flex: 2, padding: 8 }}
            />
            <input
              type="text"
              value={input.symbole}
              onChange={(e) => modifierChamp(unite.id, { symbole: e.target.value })}
              style={{ width: 80, padding: 8 }}
            />
            <select
              value={input.type}
              onChange={(e) => modifierChamp(unite.id, { type: e.target.value })}
              style={{ width: 100, padding: 8 }}
            >
              {TYPES_UNITE.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={input.facteurBase}
              onChange={(e) => modifierChamp(unite.id, { facteurBase: Number(e.target.value) })}
              style={{ width: 90, padding: 8 }}
            />
            <button className="btn-primary" onClick={() => enregistrer(unite)}>Enregistrer</button>
            <button className="btn-danger" onClick={() => supprimer(unite)}>Supprimer</button>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          type="text"
          placeholder="Nom"
          value={nouvelle.nom}
          onChange={(e) => setNouvelle((prec) => ({ ...prec, nom: e.target.value }))}
          style={{ flex: 2, padding: 8 }}
        />
        <input
          type="text"
          placeholder="Symbole"
          value={nouvelle.symbole}
          onChange={(e) => setNouvelle((prec) => ({ ...prec, symbole: e.target.value }))}
          style={{ width: 80, padding: 8 }}
        />
        <select
          value={nouvelle.type}
          onChange={(e) => setNouvelle((prec) => ({ ...prec, type: e.target.value }))}
          style={{ width: 100, padding: 8 }}
        >
          {TYPES_UNITE.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={nouvelle.facteurBase}
          onChange={(e) =>
            setNouvelle((prec) => ({ ...prec, facteurBase: Number(e.target.value) }))
          }
          style={{ width: 90, padding: 8 }}
        />
        <button className="btn-primary" onClick={ajouter}>Ajouter</button>
      </div>
    </div>
  );
}
