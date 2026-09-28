import toast from "react-hot-toast";
import { useEffect, useState } from "react";
import {
  creerSousCategorieRecette,
  getSousCategoriesRecette,
  modifierSousCategorieRecette,
  supprimerSousCategorieRecette,
} from "../services/parametresService";
import type { SousCategorieRecette } from "../types/parametres";

const AUCUN_PARENT = "";

export default function SousCategoriesRecetteManager() {
  const [sousCategories, setSousCategories] = useState<SousCategorieRecette[]>([]);
  const [noms, setNoms] = useState<Record<number, string>>({});
  const [parents, setParents] = useState<Record<number, string>>({});
  const [nouveauNom, setNouveauNom] = useState("");
  const [nouveauParent, setNouveauParent] = useState(AUCUN_PARENT);

  function chargerSousCategories() {
    getSousCategoriesRecette().then((data) => {
      setSousCategories(data);
      setNoms(Object.fromEntries(data.map((s) => [s.id, s.nom])));
      setParents(
        Object.fromEntries(data.map((s) => [s.id, s.parentId != null ? String(s.parentId) : AUCUN_PARENT]))
      );
    });
  }

  useEffect(() => {
    chargerSousCategories();
  }, []);

  async function ajouter() {
    if (!nouveauNom.trim()) return;
    try {
      await creerSousCategorieRecette(nouveauNom.trim(), nouveauParent ? Number(nouveauParent) : null);
      setNouveauNom("");
      setNouveauParent(AUCUN_PARENT);
      chargerSousCategories();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function enregistrer(sousCategorie: SousCategorieRecette) {
    const nom = noms[sousCategorie.id]?.trim();
    const parentBrut = parents[sousCategorie.id] ?? AUCUN_PARENT;
    const parentId = parentBrut ? Number(parentBrut) : null;
    if (!nom) return;
    if (nom === sousCategorie.nom && parentId === sousCategorie.parentId) return;
    try {
      await modifierSousCategorieRecette(sousCategorie.id, nom, parentId);
      chargerSousCategories();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function supprimer(sousCategorie: SousCategorieRecette) {
    if (!confirm(`Supprimer la sous-catégorie "${sousCategorie.nom}" ?`)) return;
    try {
      await supprimerSousCategorieRecette(sousCategorie.id);
      chargerSousCategories();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  // Seules les sous-catégories racines (sans parent) sont proposées comme parent possible : la
  // hiérarchie n'a qu'un seul niveau par conception (voir prisma/schema.prisma) — offrir un enfant
  // comme parent permettrait une chaîne à plusieurs niveaux, voire un cycle, que le serveur
  // n'empêche pas lui-même.
  const racinesPossibles = sousCategories.filter((candidat) => candidat.parentId === null);

  return (
    <div>
      {sousCategories.map((sousCategorie) => (
        <div
          key={sousCategorie.id}
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
        >
          <input
            type="text"
            value={noms[sousCategorie.id] ?? ""}
            onChange={(e) => setNoms((prec) => ({ ...prec, [sousCategorie.id]: e.target.value }))}
            style={{ flex: 1, padding: 8 }}
          />
          <select
            value={parents[sousCategorie.id] ?? AUCUN_PARENT}
            onChange={(e) => setParents((prec) => ({ ...prec, [sousCategorie.id]: e.target.value }))}
            style={{ padding: 8 }}
          >
            <option value={AUCUN_PARENT}>Racine (aucun parent)</option>
            {racinesPossibles
              .filter((candidat) => candidat.id !== sousCategorie.id)
              .map((candidat) => (
                <option key={candidat.id} value={candidat.id}>
                  {candidat.nom}
                </option>
              ))}
          </select>
          <button onClick={() => enregistrer(sousCategorie)}>Enregistrer</button>
          <button className="btn-danger" onClick={() => supprimer(sousCategorie)}>
            Supprimer
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          type="text"
          placeholder="Nouvelle sous-catégorie (ex. Bœuf, Veau…)"
          value={nouveauNom}
          onChange={(e) => setNouveauNom(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <select
          value={nouveauParent}
          onChange={(e) => setNouveauParent(e.target.value)}
          style={{ padding: 8 }}
        >
          <option value={AUCUN_PARENT}>Racine (aucun parent)</option>
          {racinesPossibles.map((candidat) => (
            <option key={candidat.id} value={candidat.id}>
              {candidat.nom}
            </option>
          ))}
        </select>
        <button className="btn-primary" onClick={ajouter}>
          Ajouter
        </button>
      </div>
    </div>
  );
}
