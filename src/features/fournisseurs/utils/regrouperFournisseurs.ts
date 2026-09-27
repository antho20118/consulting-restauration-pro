import type { Fournisseur } from "../types/fournisseur";

// Chantier « refonte liste fournisseurs » : plusieurs fiches fournisseur physiques (lignes
// distinctes en base, jamais fusionnées ni modifiées ici) peuvent partager le même nom. Ce module
// ne fait qu'organiser la présentation : il regroupe les fournisseurs actifs par nom pour n'afficher
// qu'une seule carte par nom dans la liste, tout en conservant l'accès à chaque fournisseur
// physique et à l'ensemble de ses tarifs propres.
//
// Règle de regroupement (validée explicitement) : trim() des espaces en début/fin, comparaison
// insensible à la casse, aucune autre normalisation (les accents ne sont jamais supprimés, la
// valeur du nom affiché n'est jamais modifiée).

export type GroupeFournisseur = {
  cleGroupe: string;
  nom: string;
  fournisseurs: Fournisseur[];
  totalTarifs: number;
};

function cleDeGroupe(nom: string): string {
  return nom.trim().toLowerCase();
}

export function regrouperFournisseursParNom(fournisseurs: Fournisseur[]): GroupeFournisseur[] {
  const groupes = new Map<string, GroupeFournisseur>();

  for (const fournisseur of fournisseurs) {
    const cle = cleDeGroupe(fournisseur.nom);
    const groupe = groupes.get(cle);
    if (groupe) {
      groupe.fournisseurs.push(fournisseur);
      groupe.totalTarifs += fournisseur._count?.tarifs ?? 0;
    } else {
      groupes.set(cle, {
        cleGroupe: cle,
        nom: fournisseur.nom,
        fournisseurs: [fournisseur],
        totalTarifs: fournisseur._count?.tarifs ?? 0,
      });
    }
  }

  return Array.from(groupes.values());
}
