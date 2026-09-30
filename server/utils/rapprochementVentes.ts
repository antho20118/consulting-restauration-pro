// Moteur de rapprochement produit vendu -> recette pour l'import de ventes (export CSV/Excel d'une
// caisse enregistreuse/logiciel d'encaissement), même principe que rapprochementFournisseur.ts
// appliqué au rapprochement produit vendu -> recette : réutilise similariteJaccard et
// SEUIL_CORRESPONDANCE_DESIGNATION (importListing.ts) et normaliserTexte (partagé avec la clé
// d'AliasIngredientImport), sans dupliquer leur logique.
//
// Pas de CODE_ARTICLE/REFERENCE_FOURNISSEUR ici : une Recette n'a ni code ni référence fournisseur,
// seulement un nom (voir MotifCorrespondanceVente, prisma/schema.prisma). Pure fonction : ne lit ni
// n'écrit jamais en base, et ne décide jamais rien seule — LigneVente.decision reste toujours
// EN_ATTENTE tant qu'un humain n'a pas validé la proposition produite ici (voir server/routes/ventes.ts).

import { normaliserTexte } from "./normaliserTexte.js";
import { similariteJaccard, SEUIL_CORRESPONDANCE_DESIGNATION } from "./importListing.js";

export type CandidatRecetteVente = {
  recetteId: number;
  nom: string;
};

export type CandidatScoreVente = {
  recetteId: number;
  nom: string;
  score: number;
};

export type ResultatRapprochementVente =
  | { cas: "certaine"; recetteId: number; motif: "ALIAS" | "DESIGNATION_EXACTE" }
  | { cas: "approximative_unique"; recetteId: number; score: number }
  | { cas: "plusieurs_candidats"; candidats: CandidatScoreVente[] }
  | { cas: "aucun_candidat" };

export type ContexteRapprochementVente = {
  candidats: CandidatRecetteVente[];
  // texteNormalise (server/utils/normaliserTexte.ts) -> recetteId, reflet direct et en lecture
  // seule d'AliasProduitVenduImport — jamais un second système d'alias, jamais une donnée dupliquée.
  aliasParTexteNormalise: Map<string, number>;
};

// Une désignation lue sur un export de caisse n'a ni code produit ni référence exploitable
// (contrairement à un listing fournisseur) : seuls le texte de la désignation et l'historique
// d'alias déjà confirmés permettent de proposer une recette, jamais un identifiant tiers.
export function rapprocherLigneVente(
  designation: string,
  contexte: ContexteRapprochementVente
): ResultatRapprochementVente {
  const designationNormalisee = normaliserTexte(designation);

  // --- Priorité 1 : alias déjà appris (import précédent confirmé par un humain) ---
  const recetteIdParAlias = contexte.aliasParTexteNormalise.get(designationNormalisee);
  if (recetteIdParAlias !== undefined) {
    const candidatAlias = contexte.candidats.find((c) => c.recetteId === recetteIdParAlias);
    if (candidatAlias) return { cas: "certaine", recetteId: candidatAlias.recetteId, motif: "ALIAS" };
  }

  // --- Priorité 2 : désignation normalisée strictement identique au nom d'une recette suivie ---
  const parDesignationExacte = contexte.candidats.find((c) => normaliserTexte(c.nom) === designationNormalisee);
  if (parDesignationExacte) {
    return { cas: "certaine", recetteId: parDesignationExacte.recetteId, motif: "DESIGNATION_EXACTE" };
  }

  // --- Priorité 3 : similarité de Jaccard, jamais appliquée seule sans validation humaine ---
  const scores: CandidatScoreVente[] = contexte.candidats
    .map((c) => ({ recetteId: c.recetteId, nom: c.nom, score: similariteJaccard(designation, c.nom) }))
    .filter((c) => c.score >= SEUIL_CORRESPONDANCE_DESIGNATION)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) return { cas: "aucun_candidat" };
  if (scores.length === 1) {
    return { cas: "approximative_unique", recetteId: scores[0].recetteId, score: scores[0].score };
  }
  return { cas: "plusieurs_candidats", candidats: scores };
}
