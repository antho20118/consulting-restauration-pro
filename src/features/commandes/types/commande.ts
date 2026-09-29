// Miroir des types serveur (server/routes/commandes.ts, prisma/schema.prisma) — dupliqué
// délibérément entre client et serveur, jamais de module TypeScript partagé dans ce projet (même
// convention que le reste de l'application).

export type StatutCommande = "EN_ATTENTE" | "RECUE" | "RECUE_PARTIELLEMENT" | "ANNULEE";

// Même contrat que BesoinAchat (src/features/production/types/production.ts) — dupliqué plutôt que
// partagé entre features, même principe que le reste du projet.
export type BesoinAchat = {
  articleId: number;
  quantite: number;
  facteurUniteRecette: number;
};

export type LigneCommande = {
  id: number;
  commandeId: number;
  articleId: number;
  // uniteBase : libellé de l'unité de base de l'article (g/mL/pièce), déduite du tarif actif côté
  // serveur — voir commandes.ts::commandeAvecUniteBase.
  article: { id: number; nom: string; uniteBase: string };
  conditionnementLibelle: string;
  conditionnements: number;
  // Toujours en unité de base de l'article (g/mL/pièce) — voir versUniteBase côté serveur.
  quantiteCommandeeBase: number;
  quantiteRecueBase: number | null;
  prixUnitaireBase: number;
  mouvementStockId: number | null;
};

export type Commande = {
  id: number;
  fournisseurId: number;
  fournisseur: { id: number; nom: string };
  depotId: number;
  depot: { id: number; nom: string };
  statut: StatutCommande;
  creeLe: string;
  dateReception: string | null;
  lignes: LigneCommande[];
};
