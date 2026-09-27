import { Truck } from "lucide-react";
import type { GroupeFournisseur } from "../utils/regrouperFournisseurs";

// Reprend le pattern visuel de src/features/recettes/components/RecettesGrille.tsx (grille de
// cartes, zone image/icône 4:3, bloc texte) pour remplacer la présentation tabulaire (DataGrid) de
// la liste des fournisseurs. Une carte représente un GROUPE de fournisseurs homonymes (voir
// regrouperFournisseurs.ts) — jamais un enregistrement fusionné : chaque fournisseur physique et
// chacun de ses tarifs restent accessibles, individuellement, via cette carte.

type Props = {
  groupes: GroupeFournisseur[];
  onOuvrir: (groupe: GroupeFournisseur) => void;
  onEdit: (fournisseur: GroupeFournisseur["fournisseurs"][number]) => void;
  onDelete: (fournisseur: GroupeFournisseur["fournisseurs"][number]) => void;
};

export default function FournisseursGrille({ groupes, onOuvrir, onEdit, onDelete }: Props) {
  if (groupes.length === 0) {
    return <p style={{ color: "var(--couleur-texte-attenue)" }}>Aucun fournisseur.</p>;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 16,
      }}
    >
      {groupes.map((groupe) => {
        const estHomonyme = groupe.fournisseurs.length > 1;
        return (
          <div
            key={groupe.cleGroupe}
            style={{
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              borderRadius: "var(--rayon)",
              boxShadow: "var(--ombre-carte)",
              background: "#fff",
            }}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOuvrir(groupe)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOuvrir(groupe);
                }
              }}
              style={{ display: "flex", flexDirection: "column", textAlign: "left", cursor: "pointer" }}
            >
              <div
                style={{
                  width: "100%",
                  aspectRatio: "4 / 3",
                  background: "#eef1f3",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <Truck size={32} color="#aab2ba" />
              </div>
              <div style={{ padding: "10px 12px" }}>
                <div style={{ fontWeight: 600 }}>{groupe.nom}</div>
                {/* Code affiché uniquement quand un seul fournisseur physique porte ce nom : pour un
                    groupe homonyme, chaque fournisseur a son propre code, jamais résumé en un seul
                    ici (voir l'onglet dédié pour le détail par fournisseur physique). */}
                {!estHomonyme && groupe.fournisseurs[0].codeFournisseur && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#0f6848" }}>
                    {groupe.fournisseurs[0].codeFournisseur}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "var(--couleur-texte-attenue)", marginTop: 2 }}>
                  {groupe.totalTarifs} tarif(s){estHomonyme ? ` · ${groupe.fournisseurs.length} fournisseurs` : ""}
                </div>
              </div>
            </div>

            {!estHomonyme && (
              <div style={{ display: "flex", gap: 8, padding: "0 12px 12px" }}>
                <button className="btn-table" onClick={() => onEdit(groupe.fournisseurs[0])}>Modifier</button>
                <button className="btn-table btn-danger" onClick={() => onDelete(groupe.fournisseurs[0])}>Supprimer</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
