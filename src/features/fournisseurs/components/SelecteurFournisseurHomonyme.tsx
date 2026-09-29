import TarifsGroupeFournisseurs from "./TarifsGroupeFournisseurs";
import type { Fournisseur } from "../types/fournisseur";

// Affiché uniquement quand une carte regroupée représente plusieurs fournisseurs physiques
// homonymes (même nom après trim + casse-insensible). Ne fusionne jamais les enregistrements :
// chaque ligne (niveau 2) reste un fournisseur physique distinct, avec ses propres coordonnées et
// ses propres tarifs, et mène vers sa fiche existante (/fournisseurs/:id) sans aucune modification
// de celle-ci. En dessous (niveau 3, voir TarifsGroupeFournisseurs), la vue agrégée des tarifs de
// tout le groupe — toujours une présentation, jamais une fusion des données.

type Props = {
  nom: string;
  fournisseurs: Fournisseur[];
  onChoisir: (fournisseur: Fournisseur) => void;
  onEdit: (fournisseur: Fournisseur) => void;
  onDelete: (fournisseur: Fournisseur) => void;
  onClose: () => void;
};

export default function SelecteurFournisseurHomonyme({
  nom,
  fournisseurs,
  onChoisir,
  onEdit,
  onDelete,
  onClose,
}: Props) {
  return (
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
        zIndex: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: "var(--rayon)",
          boxShadow: "var(--ombre-carte)",
          width: 760,
          maxWidth: "calc(100vw - 32px)",
          boxSizing: "border-box",
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Plusieurs fournisseurs « {nom} »</h2>
        <p style={{ color: "var(--couleur-texte-attenue)" }}>
          Ce nom est partagé par {fournisseurs.length} fournisseurs distincts. Choisissez celui à ouvrir.
        </p>

        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {fournisseurs.map((fournisseur) => (
            <li
              key={fournisseur.id}
              style={{
                border: "1px solid #e2e6ea",
                borderRadius: "var(--rayon)",
                padding: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{fournisseur.nom}</div>
                <div style={{ fontSize: 13, color: "var(--couleur-texte-attenue)" }}>
                  {fournisseur.telephone && <span>Téléphone : {fournisseur.telephone}</span>}
                  {fournisseur.telephone && (fournisseur.email || fournisseur.siteWeb) && " · "}
                  {fournisseur.email && <span>{fournisseur.email}</span>}
                  {fournisseur.email && fournisseur.siteWeb && " · "}
                  {fournisseur.siteWeb && <span>{fournisseur.siteWeb}</span>}
                  {!fournisseur.telephone && !fournisseur.email && !fournisseur.siteWeb && (
                    <span>Aucune coordonnée renseignée</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--couleur-texte-attenue)" }}>
                  {fournisseur._count?.tarifs ?? 0} tarif(s)
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btn-table" onClick={() => onChoisir(fournisseur)}>Fiche</button>
                <button className="btn-table" onClick={() => onEdit(fournisseur)}>Modifier</button>
                <button className="btn-table btn-danger" onClick={() => onDelete(fournisseur)}>Supprimer</button>
              </div>
            </li>
          ))}
        </ul>

        <h3 style={{ marginTop: 24, marginBottom: 8, fontSize: 15 }}>Tarifs du groupe</h3>
        <TarifsGroupeFournisseurs fournisseurs={fournisseurs} />

        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button className="btn-table" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
