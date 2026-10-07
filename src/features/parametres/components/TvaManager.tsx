import toast from "react-hot-toast";
import { useEffect, useState } from "react";
import { creerTva, getTva, modifierTva, supprimerTva } from "../services/parametresService";
import type { Tva, TvaInput } from "../types/parametres";

const TVA_VIDE: TvaInput = { nom: "", taux: 0 };

// F11 de l'audit forensique, volet UI : TVA est un référentiel partagé entre toutes les sociétés
// (voir schema.prisma et server/middleware/autoriserEcritureSuperAdmin.ts, qui refuse déjà toute
// écriture côté serveur à qui n'est pas superAdmin). La lecture reste ouverte à tout rôle — chaque
// société doit pouvoir choisir un taux existant dans ses formulaires d'ingrédients — mais les
// contrôles d'édition/suppression/ajout n'ont plus de sens pour un simple PROPRIETAIRE : avant ce
// correctif, ils s'affichaient normalement puis échouaient silencieusement (toast d'erreur 403) au
// clic, sans jamais expliquer pourquoi. `estSuperAdmin` ne sert ici qu'à masquer l'UI (comme pour
// tout le reste de l'application, voir config/api.ts) — jamais une source de vérité d'autorisation.
export default function TvaManager({ estSuperAdmin }: { estSuperAdmin: boolean }) {
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

  if (!estSuperAdmin) {
    return (
      <div>
        <p style={{ color: "#898781", marginTop: 0 }}>
          Référentiel partagé entre toutes les sociétés — modification réservée à l'administrateur
          de la plateforme.
        </p>
        {tvas.map((tva) => (
          <div key={tva.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <span style={{ flex: 1 }}>{tva.nom}</span>
            <span>{tva.taux} %</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {tvas.map((tva) => {
        const input = edits[tva.id] ?? TVA_VIDE;
        return (
          <div
            key={tva.id}
            style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}
          >
            <input
              type="text"
              value={input.nom}
              onChange={(e) => modifierChamp(tva.id, { nom: e.target.value })}
              style={{ flex: 1, minWidth: 0, padding: 8 }}
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

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Nom (ex. TVA 10 %)"
          value={nouvelle.nom}
          onChange={(e) => setNouvelle((prec) => ({ ...prec, nom: e.target.value }))}
          style={{ flex: 1, minWidth: 0, padding: 8 }}
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
