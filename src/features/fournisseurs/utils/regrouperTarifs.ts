import type { Fournisseur } from "../types/fournisseur";
import type { TarifFournisseur } from "../services/fournisseurService";

// Chantier « regroupement des tarifs homonymes » : agrège, pour une présentation uniquement, les
// tarifs de plusieurs fournisseurs physiques partageant le même nom (voir regrouperFournisseurs.ts
// pour la règle de regroupement des noms). Aucune fusion : chaque tarif conserve son id, son
// article, son prix, son unité, son conditionnement, ses dates et — c'est le point ajouté ici — une
// référence explicite vers son fournisseur physique d'origine. Deux tarifs concernant le même
// article mais venant de deux fournisseurs différents restent deux entrées distinctes.

export type TarifAvecFournisseur = TarifFournisseur & { fournisseurOrigine: Fournisseur };

export type TarifsParFournisseur = {
  fournisseur: Fournisseur;
  tarifs: TarifFournisseur[];
};

export function fusionnerTarifsGroupe(parFournisseur: TarifsParFournisseur[]): TarifAvecFournisseur[] {
  const tous: TarifAvecFournisseur[] = parFournisseur.flatMap(({ fournisseur, tarifs }) =>
    tarifs.map((tarif) => ({ ...tarif, fournisseurOrigine: fournisseur }))
  );

  return tous.sort((a, b) => {
    const parArticle = a.article.nom.localeCompare(b.article.nom);
    if (parArticle !== 0) return parArticle;
    return a.fournisseurOrigine.id - b.fournisseurOrigine.id;
  });
}
