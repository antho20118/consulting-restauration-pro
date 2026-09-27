// Moteur de rapprochement étendu pour l'import de listings/factures fournisseurs par photo (voir
// cadrage Phase 0-3, chantier fiche fournisseur/historique des tarifs). Fichier séparé de
// server/utils/importListing.ts, délibérément — il réutilise ses fonctions déjà éprouvées
// (similariteJaccard, SEUIL_CORRESPONDANCE_DESIGNATION) sans en modifier une seule ligne, pour
// garantir zéro régression sur l'import listing par fichier existant (analyserPropositionLigne,
// inchangé, continue d'être le seul moteur utilisé par ce chemin tant que la Phase 4 ne l'a pas
// rebranché explicitement).
//
// Ce moteur ne produit QUE des propositions (niveau B) : aucune fonction de ce fichier n'écrit en
// base de données, n'importe prisma, ni ne décide d'une application de tarif (niveau C).

import { normaliserTexte } from "./normaliserTexte.js";
import { similariteJaccard, SEUIL_CORRESPONDANCE_DESIGNATION } from "./importListing.js";

export type NatureLigneDetectee = "ARTICLE" | "FRAIS_LIVRAISON" | "AVOIR" | "NON_ALIMENTAIRE" | "REMISE";

// Détection par mots-clés, volontairement simple et inspectable (jamais un classifieur opaque) :
// une ligne dont la nature n'est reconnue par aucun mot-clé reste ARTICLE — c'est l'état qui exige
// une validation humaine dans le pipeline (decision reste EN_ATTENTE), conformément à la règle « si
// la nature ne peut pas être déterminée de manière fiable, elle doit rester dans un état nécessitant
// une validation » : ne jamais inventer une classification non alimentaire à partir d'un simple
// texte sans signal fiable.
const MOTS_CLES_AVOIR = ["avoir"];
const MOTS_CLES_FRAIS_LIVRAISON = ["livraison", "frais de port", "transport"];
const MOTS_CLES_REMISE = ["remise", "ristourne", "escompte"];
const MOTS_CLES_NON_ALIMENTAIRE = [
  "entretien",
  "hygiene",
  "nettoyant",
  "desinfectant",
  "poubelle",
  "essuie tout",
  "sopalin",
  "papier toilette",
  "gant",
];

function contientUnMotCle(texteNormalise: string, motsCles: string[]): boolean {
  return motsCles.some((mot) => texteNormalise.includes(mot));
}

export function detecterNatureLigne(designation: string): NatureLigneDetectee {
  const texte = normaliserTexte(designation);
  if (contientUnMotCle(texte, MOTS_CLES_AVOIR)) return "AVOIR";
  if (contientUnMotCle(texte, MOTS_CLES_FRAIS_LIVRAISON)) return "FRAIS_LIVRAISON";
  if (contientUnMotCle(texte, MOTS_CLES_REMISE)) return "REMISE";
  if (contientUnMotCle(texte, MOTS_CLES_NON_ALIMENTAIRE)) return "NON_ALIMENTAIRE";
  return "ARTICLE";
}

export type CandidatScore = {
  articleId: number;
  nom: string;
  score: number;
};

// Motif réellement produit par ce moteur : "CODE_ARTICLE" existe dans l'enum Prisma
// (MotifCorrespondance) mais n'est jamais renvoyé ici — voir le point exposé en Phase 3 : le
// modèle de données actuel ne distingue pas "référence fournisseur" de "code article interne"
// (un seul champ Article.reference), donc ce niveau de priorité est confondu avec le niveau 1
// jusqu'à décision explicite sur ce point.
export type MotifRapprochement = "REFERENCE_FOURNISSEUR" | "DESIGNATION_EXACTE" | "ALIAS" | "DESIGNATION_APPROXIMATIVE";

export type ResultatRapprochement =
  | { cas: "certaine"; articleId: number; motif: Exclude<MotifRapprochement, "DESIGNATION_APPROXIMATIVE"> }
  | { cas: "approximative_unique"; articleId: number; score: number }
  | { cas: "plusieurs_candidats"; candidats: CandidatScore[] }
  | { cas: "aucun_candidat" };

export type CandidatRapprochement = {
  articleId: number;
  nom: string;
  reference: string | null;
  // Type de l'unité du tarif actif de ce candidat (Unite.type, ex. "poids"/"volume"/"piece"),
  // null si l'article n'a pas encore de tarif — voir le filtre de cohérence ci-dessous.
  uniteActiveType: string | null;
};

export type ContexteRapprochement = {
  candidats: CandidatRapprochement[];
  // texteNormalise (server/utils/normaliserTexte.ts) -> articleId, reflet direct et en lecture
  // seule de AliasIngredientImport — jamais un second système d'alias, jamais une donnée dupliquée.
  aliasParTexteNormalise: Map<string, number>;
};

// Une ligne dont la référence diffère explicitement de celle d'un candidat n'est jamais ce
// candidat, même si la désignation se ressemble — reprend exactement la règle déjà appliquée par
// trouverCorrespondance (importListing.ts) : quand la ligne porte une référence, tout candidat
// portant lui-même une référence (différente, puisqu'on a déjà cherché une correspondance exacte)
// est écarté du reste de la recherche, pour ne jamais confondre deux produits référencés distincts.
function candidatsEligibles(reference: string | null, candidats: CandidatRapprochement[]): CandidatRapprochement[] {
  if (!reference || !reference.trim()) return candidats;
  return candidats.filter((c) => !(c.reference && c.reference.trim()));
}

export function rapprocherLigne(
  designation: string,
  reference: string | null,
  uniteDetecteeType: string | null,
  contexte: ContexteRapprochement
): ResultatRapprochement {
  const designationNormalisee = normaliserTexte(designation);

  // --- Niveau "certaine", priorités 1+2 (voir le point exposé sur la fusion référence/code) ---
  if (reference && reference.trim()) {
    const parReference = contexte.candidats.find(
      (c) => c.reference && c.reference.trim().toLowerCase() === reference.trim().toLowerCase()
    );
    if (parReference) return { cas: "certaine", articleId: parReference.articleId, motif: "REFERENCE_FOURNISSEUR" };
  }

  const eligibles = candidatsEligibles(reference, contexte.candidats);

  // --- Priorité 3 : désignation normalisée exacte ---
  const parDesignationExacte = eligibles.find((c) => normaliserTexte(c.nom) === designationNormalisee);
  if (parDesignationExacte) {
    return { cas: "certaine", articleId: parDesignationExacte.articleId, motif: "DESIGNATION_EXACTE" };
  }

  // --- Priorité 4 : alias connu (AliasIngredientImport, lecture seule) ---
  const articleIdParAlias = contexte.aliasParTexteNormalise.get(designationNormalisee);
  if (articleIdParAlias !== undefined) {
    const candidatAlias = eligibles.find((c) => c.articleId === articleIdParAlias);
    if (candidatAlias) return { cas: "certaine", articleId: candidatAlias.articleId, motif: "ALIAS" };
  }

  // --- Priorités 5+6 : conditionnement/unité cohérents, puis similarité (mécanisme existant) ---
  const scores: CandidatScore[] = eligibles
    .filter((c) => {
      // Un candidat dont l'unité du tarif actif est d'une famille différente de celle détectée sur
      // la ligne (ex. ligne au poids vs candidat historiquement vendu à la pièce) n'est jamais une
      // correspondance approximative valable, même à désignation très proche (voir §8 du cadrage).
      // Aucun filtre si l'une des deux familles est inconnue (candidat sans tarif, ou unité non
      // détectée sur la ligne) : on ne bloque jamais sur une donnée absente.
      if (!uniteDetecteeType || !c.uniteActiveType) return true;
      return uniteDetecteeType === c.uniteActiveType;
    })
    .map((c) => ({ articleId: c.articleId, nom: c.nom, score: similariteJaccard(designation, c.nom) }))
    .filter((c) => c.score >= SEUIL_CORRESPONDANCE_DESIGNATION)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) return { cas: "aucun_candidat" };
  if (scores.length === 1) return { cas: "approximative_unique", articleId: scores[0].articleId, score: scores[0].score };
  return { cas: "plusieurs_candidats", candidats: scores };
}
