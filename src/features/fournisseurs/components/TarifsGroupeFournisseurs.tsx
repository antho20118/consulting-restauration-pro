import { useEffect, useState } from "react";
import { getTarifsFournisseur } from "../services/fournisseurService";
import { fusionnerTarifsGroupe, type TarifAvecFournisseur, type TarifsParFournisseur } from "../utils/regrouperTarifs";
import type { Fournisseur } from "../types/fournisseur";

// Niveau 3 de la vue groupée (voir SelecteurFournisseurHomonyme.tsx pour les niveaux 1 et 2) :
// appelle la route existante GET /fournisseurs/:id/tarifs pour chaque fournisseur physique du
// groupe (aucune évolution backend — le nombre d'homonymes est toujours faible), puis agrège côté
// client. Chaque ligne affiche explicitement son fournisseur d'origine : deux tarifs sur le même
// article restent deux lignes distinctes, jamais fusionnées ni écrasées l'une par l'autre.

type Props = { fournisseurs: Fournisseur[] };

export default function TarifsGroupeFournisseurs({ fournisseurs }: Props) {
  const [tarifs, setTarifs] = useState<TarifAvecFournisseur[] | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let annule = false;

    // Différé d'un micro-tick (même convention que FournisseurDetailPage.tsx) : aucun appel
    // setState ne doit être atteignable de façon synchrone depuis le corps de l'effet lui-même
    // (règle react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      if (annule) return;
      setTarifs(null);
      setErreur("");

      Promise.all(
        fournisseurs.map(
          async (fournisseur): Promise<TarifsParFournisseur> => ({
            fournisseur,
            tarifs: await getTarifsFournisseur(fournisseur.id),
          })
        )
      )
        .then((parFournisseur) => {
          if (!annule) setTarifs(fusionnerTarifsGroupe(parFournisseur));
        })
        .catch(() => {
          if (!annule) setErreur("Impossible de charger les tarifs de ce groupe de fournisseurs.");
        });
    });

    return () => {
      annule = true;
    };
  }, [fournisseurs]);

  if (erreur) return <p style={{ color: "#b00020", fontSize: 13 }}>{erreur}</p>;
  if (tarifs === null) {
    return <p style={{ fontSize: 13, color: "var(--couleur-texte-attenue)" }}>Chargement des tarifs…</p>;
  }
  if (tarifs.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--couleur-texte-attenue)" }}>
        Aucun tarif enregistré pour ce groupe de fournisseurs.
      </p>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Article</th>
            <th style={{ padding: 8 }}>Fournisseur</th>
            <th style={{ padding: 8 }}>Prix HT</th>
            <th style={{ padding: 8 }}>Unité</th>
            <th style={{ padding: 8 }}>Conditionnement</th>
            <th style={{ padding: 8 }}>Statut</th>
          </tr>
        </thead>
        <tbody>
          {tarifs.map((tarif) => (
            <tr key={tarif.id} style={{ borderBottom: "1px solid #eee", opacity: tarif.actif ? 1 : 0.6 }}>
              <td style={{ padding: 8 }}>{tarif.article.nom}</td>
              <td style={{ padding: 8 }}>
                {tarif.fournisseurOrigine.nom}
                {tarif.fournisseurOrigine.telephone ? ` (${tarif.fournisseurOrigine.telephone})` : ""}
              </td>
              <td style={{ padding: 8 }}>{tarif.prixHT.toFixed(4)} €</td>
              <td style={{ padding: 8 }}>{tarif.unite.symbole}</td>
              <td style={{ padding: 8 }}>{tarif.conditionnement.nom}</td>
              <td style={{ padding: 8 }}>
                {tarif.actif
                  ? "Actif"
                  : `Clôturé${tarif.dateFin ? ` le ${new Date(tarif.dateFin).toLocaleDateString("fr-FR")}` : ""}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
