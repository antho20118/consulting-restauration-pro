import toast from "react-hot-toast";
import { useEffect, useState } from "react";
import {
  creerCategorieRecette,
  getCategoriesRecette,
  modifierCategorieRecette,
  supprimerCategorieRecette,
} from "../services/parametresService";
import type { CategorieRecette } from "../types/parametres";

export default function CategoriesRecetteManager() {
  const [categories, setCategories] = useState<CategorieRecette[]>([]);
  const [noms, setNoms] = useState<Record<number, string>>({});
  const [nouveauNom, setNouveauNom] = useState("");

  function chargerCategories() {
    getCategoriesRecette().then((data) => {
      setCategories(data);
      setNoms(Object.fromEntries(data.map((c) => [c.id, c.nom])));
    });
  }

  useEffect(() => {
    chargerCategories();
  }, []);

  async function ajouter() {
    if (!nouveauNom.trim()) return;
    try {
      await creerCategorieRecette(nouveauNom.trim());
      setNouveauNom("");
      chargerCategories();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function renommer(categorie: CategorieRecette) {
    const nom = noms[categorie.id]?.trim();
    if (!nom || nom === categorie.nom) return;
    try {
      await modifierCategorieRecette(categorie.id, nom);
      chargerCategories();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  async function supprimer(categorie: CategorieRecette) {
    if (!confirm(`Supprimer la catégorie "${categorie.nom}" ?`)) return;
    try {
      await supprimerCategorieRecette(categorie.id);
      chargerCategories();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur inconnue");
    }
  }

  return (
    <div>
      {categories.map((categorie) => (
        <div
          key={categorie.id}
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
        >
          <input
            type="text"
            value={noms[categorie.id] ?? ""}
            onChange={(e) => setNoms((prec) => ({ ...prec, [categorie.id]: e.target.value }))}
            style={{ flex: 1, padding: 8 }}
          />
          <button onClick={() => renommer(categorie)}>Renommer</button>
          <button className="btn-danger" onClick={() => supprimer(categorie)}>Supprimer</button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          type="text"
          placeholder="Nouvelle catégorie (ex. Festif, Mariage…)"
          value={nouveauNom}
          onChange={(e) => setNouveauNom(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <button className="btn-primary" onClick={ajouter}>Ajouter</button>
      </div>
    </div>
  );
}
