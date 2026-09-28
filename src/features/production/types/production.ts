// Miroir des types serveur (server/utils/planifierProduction.ts, server/routes/achats.ts) —
// dupliqué délibérément entre client et serveur, jamais de module TypeScript partagé dans ce
// projet (même convention que le reste de l'application).

export type CibleProduction =
  | { mode: "portions"; valeur: number }
  | { mode: "poidsFiniG"; valeur: number };

export type LignePlanificationProduction = {
  articleId: number;
  article: { id: number; nom: string };
  unite: { id: number; symbole: string; facteurBase: number };
  // Quantité telle qu'elle apparaît sur la fiche recette (échelle 1, avant mise à l'échelle vers
  // la cible de production) — affichée pour comparaison, jamais utilisée pour un calcul ici.
  quantiteRecette: number;
  // Quantité réellement nécessaire pour la cible de production demandée, déjà en unité de base
  // (g/mL/pièce) — voir planifierProduction.ts. C'est cette valeur (jamais quantiteRecette) qui
  // doit être transmise à /achats/proposition avec un facteur de conversion de 1.
  quantiteProduction: number;
  // Stock du dépôt choisi, en unité de base — 0 si aucun dépôt n'a été sélectionné.
  stockDisponible: number;
  // max(0, quantiteProduction - stockDisponible) — déjà net de stock, uniquement informatif ici :
  // ne jamais le renvoyer à /achats/proposition (qui refait sa propre déduction de stock à partir
  // de quantiteProduction, pour éviter une double déduction).
  besoinNet: number;
  gainCuissonPct: number;
};

export type PlanificationProduction = {
  recetteId: number;
  recetteNom: string;
  mode: CibleProduction["mode"];
  cible: number;
  echelle: number;
  poidsFiniCibleG: number;
  portionsCible: number;
  lignes: LignePlanificationProduction[];
};

export type BesoinAchat = {
  articleId: number;
  // Toujours en unité de base ici (facteurUniteRecette vaut systématiquement 1 côté appelant —
  // voir productionService.ts) : la mise à l'échelle recette->production est déjà faite par
  // planifierProduction, /achats/proposition ne doit jamais la refaire une seconde fois.
  quantite: number;
  facteurUniteRecette: number;
};

export type LigneAchat =
  | {
      articleId: number;
      article: string;
      besoinBase: number;
      stock: number;
      netBase: number;
      statut: "ARTICLE_INTROUVABLE";
    }
  | {
      articleId: number;
      article: string;
      besoinBase: number;
      stock: number;
      netBase: number;
      statut: "FOURNISSEUR_MANQUANT";
    }
  | {
      articleId: number;
      article: string;
      besoinBase: number;
      stock: number;
      netBase: number;
      fournisseur: string;
      fournisseurId: number;
      conditionnement: string;
      conditionnements: number;
      quantiteCommandeeBase: number;
      prixUnitaireBase: number;
      coutCommandeHT: number;
      statut: "A_COMMANDER" | "STOCK_SUFFISANT";
    };

export type PropositionAchat = {
  lignes: LigneAchat[];
  totalHT: number;
};
