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

// F11 de l'audit forensique, volet UI : même raisonnement que TvaManager — Unite est un
// référentiel partagé entre toutes les sociétés (voir schema.prisma et
// server/middleware/autoriserEcritureSuperAdmin.ts, qui refuse déjà toute écriture côté serveur à
// qui n'est pas superAdmin). `estSuperAdmin` ne sert ici qu'à masquer l'UI, jamais une source de
// vérité d'autorisation (toujours revérifiée côté serveur).
export default function UnitesManager({ estSuperAdmin }: { estSuperAdmin: boolean }) {
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

  if (!estSuperAdmin) {
    return (
      <div>
        <p style={{ color: "#898781", marginTop: 0 }}>
          Référentiel partagé entre toutes les sociétés — modification réservée à l'administrateur
          de la plateforme.
        </p>
        {unites.map((unite) => (
          <div key={unite.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <span style={{ flex: 2 }}>{unite.nom}</span>
            <span style={{ width: 80 }}>{unite.symbole}</span>
            <span style={{ width: 100 }}>{unite.type}</span>
            <span style={{ width: 90 }}>{unite.facteurBase}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {unites.map((unite) => {
        const input = edits[unite.id] ?? UNITE_VIDE;
        return (
          <div
            key={unite.id}
            style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}
          >
            <input
              type="text"
              value={input.nom}
              onChange={(e) => modifierChamp(unite.id, { nom: e.target.value })}
              style={{ flex: 2, minWidth: 0, padding: 8 }}
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

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Nom"
          value={nouvelle.nom}
          onChange={(e) => setNouvelle((prec) => ({ ...prec, nom: e.target.value }))}
          style={{ flex: 2, minWidth: 0, padding: 8 }}
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
