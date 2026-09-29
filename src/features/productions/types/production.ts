// Miroir des types serveur (server/routes/productions.ts, server/utils/haccp.ts,
// prisma/schema.prisma) — dupliqué délibérément entre client et serveur, jamais de module
// TypeScript partagé dans ce projet (même convention que le reste de l'application).

export type RegleHACCP = {
  code: string;
  nom: string;
  motsCles: string[];
  risque: string;
  mesurePreventive: string;
  limiteCritique: string;
  surveillance: string;
  actionCorrective: string;
};

// Une étape de recette jugée critique (règle détectée par mots-clés et/ou point critique déclaré
// par l'utilisateur, voir evaluerEtapesHACCP côté serveur) — recalculée à chaque consultation
// d'une production à partir de l'état ACTUEL de la recette, jamais figée à la création.
export type EtapeCritique = {
  id: number;
  recetteId: number;
  ordre: number;
  description: string;
  pointCritiqueHACCP: boolean;
  controleHACCP: string | null;
  reglesDetectees: RegleHACCP[];
  aValider: boolean;
};

// Un contrôle réellement effectué, daté — jamais modifiable ni supprimable une fois créé (voir
// POST /productions/:id/controles, aucune route PATCH/DELETE).
export type ControleHACCP = {
  id: number;
  productionId: number;
  recetteEtapeId: number;
  dateHeure: string;
  valeur: string;
  conforme: boolean;
  commentaire: string | null;
};

export type Production = {
  id: number;
  recetteId: number;
  recette: { id: number; nom: string };
  societeId: number;
  depotId: number | null;
  depot: { id: number; nom: string } | null;
  dateProduction: string;
  portionsProduites: number;
  poidsFiniProduitG: number;
  createdAt: string;
  controles: ControleHACCP[];
  // Présents uniquement sur GET /productions (liste) — résumé HACCP calculé côté serveur, jamais
  // recalculé côté client.
  pointsCritiquesTotal?: number;
  pointsCritiquesControles?: number;
};

export type ProductionDetail = Production & { etapesCritiques: EtapeCritique[] };
