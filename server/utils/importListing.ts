// Logique de rapprochement d'un listing fournisseur importé (Excel/CSV) avec les ingrédients
// déjà connus, portée depuis l'application "fiches-recettes" : normalisation de texte,
// similarité de Jaccard, extraction de quantité/unité depuis une désignation, et répartition
// entre créations et mises à jour de prix.

const MOTS_VIDES = new Set([
  "de", "du", "des", "la", "le", "les", "en", "et", "au", "aux", "un", "une",
  "kg", "g", "l", "ml", "cl", "pc", "pce", "piece", "pieces", "x",
  "boite", "boites", "sachet", "sachets", "sac", "sacs", "carton", "cartons",
  "barquette", "barquettes", "colis", "unite", "unites", "filet", "filets",
]);

function normaliserTexte(texte: string): string[] {
  return (texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((m) => m.length > 1 && !MOTS_VIDES.has(m) && !/^\d+$/.test(m));
}

export function similariteJaccard(a: string, b: string): number {
  const A = new Set(normaliserTexte(a));
  const B = new Set(normaliserTexte(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((m) => {
    if (B.has(m)) inter++;
  });
  const union = new Set([...A, ...B]).size;
  return inter / union;
}

export function parsePrix(val: unknown): number | null {
  if (typeof val === "number") return val;
  const m = String(val ?? "")
    .replace(/\s/g, "")
    .match(/-?\d+([.,]\d+)?/);
  if (!m) return null;
  return parseFloat(m[0].replace(",", "."));
}

// Unités de poids/volume reconnues dans une désignation ou un conditionnement fournisseur
// (ex. "EMMENTAL CUBE 10/10 500GR"), du plus spécifique au plus court pour éviter qu'une unité
// courte (ex. "G") ne capture par erreur le début d'une unité plus longue (ex. "GR").
const UNITES_RECONNUES = "KGS|KG|GRS|GR|G|LITRES|LITRE|LT|ML|CL|L";

function normaliserUniteExtraite(token: string): { unite: "kg" | "l"; facteur: number } | null {
  switch (token.toUpperCase()) {
    case "KG":
    case "KGS":
      return { unite: "kg", facteur: 1 };
    case "G":
    case "GR":
    case "GRS":
      return { unite: "kg", facteur: 0.001 };
    case "L":
    case "LT":
    case "LITRE":
    case "LITRES":
      return { unite: "l", facteur: 1 };
    case "ML":
      return { unite: "l", facteur: 0.001 };
    case "CL":
      return { unite: "l", facteur: 0.01 };
    default:
      return null;
  }
}

// Déduit la quantité totale (poids/volume, dans l'unité de base kg ou l) d'un article à partir
// de sa désignation et/ou de son conditionnement, ex. "500GR" -> 0.5kg, "12X1L" -> 12l.
// Ne devine jamais pour les articles vendus à la pièce, faute d'unité de poids/volume détectable.
export function extraireQuantiteDesignation(
  ...textes: (string | undefined)[]
): { quantite: number; unite: "kg" | "l" } | null {
  const texte = textes.filter(Boolean).join(" ").toUpperCase();
  const nb = (s: string) => parseFloat(s.replace(",", "."));
  const finiParUnUnite = `(?![A-ZÀ-Ÿ])`;

  const reMultAvant = new RegExp(
    `(\\d+)\\s*[X×]\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNITES_RECONNUES})${finiParUnUnite}`,
    "i"
  );
  const mAvant = texte.match(reMultAvant);
  if (mAvant) {
    const conv = normaliserUniteExtraite(mAvant[3]);
    if (conv) {
      return {
        quantite: Math.round(nb(mAvant[1]) * nb(mAvant[2]) * conv.facteur * 1e6) / 1e6,
        unite: conv.unite,
      };
    }
  }

  const reMultApres = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*(${UNITES_RECONNUES})${finiParUnUnite}\\s*[X×]\\s*(\\d+)\\b`,
    "i"
  );
  const mApres = texte.match(reMultApres);
  if (mApres) {
    const conv = normaliserUniteExtraite(mApres[2]);
    if (conv) {
      return {
        quantite: Math.round(nb(mApres[1]) * conv.facteur * nb(mApres[3]) * 1e6) / 1e6,
        unite: conv.unite,
      };
    }
  }

  const reSimple = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNITES_RECONNUES})${finiParUnUnite}`, "gi");
  const simples = [...texte.matchAll(reSimple)];
  if (simples.length > 0) {
    const dernier = simples[simples.length - 1];
    const conv = normaliserUniteExtraite(dernier[2]);
    if (conv) {
      return { quantite: Math.round(nb(dernier[1]) * conv.facteur * 1e6) / 1e6, unite: conv.unite };
    }
  }

  return null;
}

export type CandidatExistant = {
  articleId: number;
  nom: string;
  reference: string | null;
};

// Rapproche une ligne importée par référence en priorité (fiable, sans ambiguïté) et ne retombe
// sur la similarité de désignation que si aucune référence n'est disponible des deux côtés. Si
// les deux ont une référence renseignée mais différente, ce n'est jamais le même article, même
// si les désignations se ressemblent.
export function trouverCorrespondance(
  designation: string,
  reference: string | null,
  candidats: CandidatExistant[]
): { candidat: CandidatExistant | null; score: number; parReference: boolean } {
  if (reference && reference.trim()) {
    const parCode = candidats.find(
      (c) => c.reference && c.reference.trim().toLowerCase() === reference.trim().toLowerCase()
    );
    if (parCode) return { candidat: parCode, score: 1, parReference: true };
  }

  let meilleur: CandidatExistant | null = null;
  let meilleurScore = 0;
  for (const c of candidats) {
    if (reference && reference.trim() && c.reference && c.reference.trim()) continue;
    const score = similariteJaccard(designation, c.nom);
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleur = c;
    }
  }
  return { candidat: meilleur, score: meilleurScore, parReference: false };
}

export const SEUIL_CORRESPONDANCE_DESIGNATION = 0.6;

// Analyse UNE ligne d'un listing fournisseur sans jamais écrire en base (voir PR #79) : produit la
// même proposition, qu'elle soit ensuite affichée en prévisualisation (POST /articles/import/apercu)
// ou réévaluée au moment de l'écriture (POST /articles/import) — jamais deux implémentations
// séparées de la détermination unité/prix/correspondance. Réutilise trouverCorrespondance,
// parsePrix et extraireQuantiteDesignation tels quels, sans dupliquer leur logique.
export type PropositionLigneImport =
  | { statut: "invalide"; designation: string; reference: string | null; motif: string }
  | {
      statut: "creation";
      designation: string;
      reference: string | null;
      fournisseurNom: string;
      prixHT: number;
      uniteId: number;
      uniteSymbole: string;
    }
  | {
      statut: "tarif_inchange";
      designation: string;
      reference: string | null;
      articleId: number;
      articleNom: string;
      typeCorrespondance: "reference" | "approximative";
      score: number | null;
    }
  | {
      statut: "tarif_a_remplacer";
      designation: string;
      reference: string | null;
      articleId: number;
      articleNom: string;
      typeCorrespondance: "reference" | "approximative";
      score: number | null;
      ancienPrixHT: number | null;
      nouveauPrixHT: number;
      fournisseurNom: string;
      uniteId: number;
      uniteSymbole: string;
    };

export type ContexteAnalyseLigne = {
  candidats: CandidatExistant[];
  // Tarif actif de chaque article candidat, préchargé une seule fois par l'appelant (jamais une
  // requête par ligne).
  tarifActifParArticle: Map<number, { prixHT: number; uniteId: number; fournisseurId: number }>;
  uniteKgId: number | null;
  uniteLId: number | null;
  unitePieceId: number | null;
  uniteSymboleParId: Map<number, string>;
};

// Fournisseur déjà résolu pour CETTE ligne par l'appelant, avec ou sans création selon son propre
// besoin (écriture : trouverOuCreerFournisseur comme aujourd'hui ; prévisualisation : lecture seule,
// jamais de création) — analyserPropositionLigne ne résout et ne crée jamais lui-même un
// fournisseur, pour ne jamais faire dépendre CE comportement (avec ses effets de bord en base) de
// l'endroit d'où la fonction est appelée.
export type FournisseurResoluLigne = {
  fournisseurId: number | null;
  fournisseurNom: string;
};

export function analyserPropositionLigne(
  ligne: { designation: string; prix: unknown; conditionnement?: string; reference?: string; fournisseur?: string },
  contexte: ContexteAnalyseLigne,
  fournisseurResolu: FournisseurResoluLigne
): PropositionLigneImport {
  const designation = String(ligne.designation ?? "").trim();
  const reference = ligne.reference ? String(ligne.reference).trim() : null;

  if (!designation) {
    return { statut: "invalide", designation, reference, motif: "Désignation manquante" };
  }

  const prixTotal = parsePrix(ligne.prix);
  if (prixTotal === null) {
    return { statut: "invalide", designation, reference, motif: "Prix illisible" };
  }

  const quantiteDetectee = extraireQuantiteDesignation(designation, ligne.conditionnement);
  let uniteId: number | null = null;
  let prixHT = prixTotal;
  if (quantiteDetectee && quantiteDetectee.quantite > 0) {
    const unite = quantiteDetectee.unite === "kg" ? contexte.uniteKgId : contexte.uniteLId;
    if (unite) {
      uniteId = unite;
      prixHT = Math.round((prixTotal / quantiteDetectee.quantite) * 10000) / 10000;
    }
  }
  if (uniteId === null && contexte.unitePieceId) uniteId = contexte.unitePieceId;
  if (uniteId === null) {
    return { statut: "invalide", designation, reference, motif: "Aucune unité disponible" };
  }

  const { fournisseurId: fournisseurIdResolu, fournisseurNom: fournisseurNomLigne } = fournisseurResolu;
  const uniteSymbole = contexte.uniteSymboleParId.get(uniteId) ?? "?";

  const { candidat, score, parReference } = trouverCorrespondance(designation, reference, contexte.candidats);
  const correspondanceValide = candidat && (parReference || score >= SEUIL_CORRESPONDANCE_DESIGNATION);

  if (!correspondanceValide || !candidat) {
    return { statut: "creation", designation, reference, fournisseurNom: fournisseurNomLigne, prixHT, uniteId, uniteSymbole };
  }

  const typeCorrespondance: "reference" | "approximative" = parReference ? "reference" : "approximative";
  const tarifActif = contexte.tarifActifParArticle.get(candidat.articleId) ?? null;

  const inchange =
    tarifActif !== null &&
    tarifActif.uniteId === uniteId &&
    fournisseurIdResolu !== null &&
    tarifActif.fournisseurId === fournisseurIdResolu &&
    tarifActif.prixHT === prixHT;

  if (inchange) {
    return {
      statut: "tarif_inchange",
      designation,
      reference,
      articleId: candidat.articleId,
      articleNom: candidat.nom,
      typeCorrespondance,
      score: typeCorrespondance === "approximative" ? score : null,
    };
  }

  return {
    statut: "tarif_a_remplacer",
    designation,
    reference,
    articleId: candidat.articleId,
    articleNom: candidat.nom,
    typeCorrespondance,
    score: typeCorrespondance === "approximative" ? score : null,
    ancienPrixHT: tarifActif?.prixHT ?? null,
    nouveauPrixHT: prixHT,
    fournisseurNom: fournisseurNomLigne,
    uniteId,
    uniteSymbole,
  };
}
