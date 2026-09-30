import { API_URL, apiFetch } from "../../../config/api";

export type LigneVenteImport = {
  designation: string;
  quantite: string;
  prixUnitaire?: string;
};

// Miroir exact des statuts produits par server/utils/rapprochementVentes.ts (ResultatRapprochementVente) —
// pas de CODE_ARTICLE/REFERENCE_FOURNISSEUR ici, une Recette n'ayant ni code ni référence
// fournisseur (voir MotifCorrespondanceVente, prisma/schema.prisma).
export type PropositionLigneVente =
  | {
      index: number;
      designationLue: string;
      quantiteVendue: number | null;
      prixVenteUnitaireLu: number | null;
      statut: "invalide";
      motif: string;
    }
  | {
      index: number;
      designationLue: string;
      quantiteVendue: number;
      prixVenteUnitaireLu: number | null;
      statut: "certaine";
      recetteProposeeId: number;
      recetteProposeeNom: string | null;
      confiance: number;
      motifCorrespondance: "ALIAS" | "DESIGNATION_EXACTE";
    }
  | {
      index: number;
      designationLue: string;
      quantiteVendue: number;
      prixVenteUnitaireLu: number | null;
      statut: "approximative_unique";
      recetteProposeeId: number;
      recetteProposeeNom: string | null;
      confiance: number;
      motifCorrespondance: "DESIGNATION_APPROXIMATIVE";
    }
  | {
      index: number;
      designationLue: string;
      quantiteVendue: number;
      prixVenteUnitaireLu: number | null;
      statut: "plusieurs_candidats";
      candidatsAlternatifs: { recetteId: number; nom: string; score: number }[];
    }
  | {
      index: number;
      designationLue: string;
      quantiteVendue: number;
      prixVenteUnitaireLu: number | null;
      statut: "aucun_candidat";
    };

export type ResultatImportVentes = {
  document: { id: number };
  validees: number;
  rejetees: number;
  enAttente: number;
  erreurs: string[];
};

export async function apercuVentes(lignes: LigneVenteImport[]): Promise<{ lignes: PropositionLigneVente[] }> {
  const response = await apiFetch(`${API_URL}/ventes/import/apercu`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lignes }),
  });

  if (!response.ok) {
    throw new Error("Impossible d'analyser ce fichier de ventes");
  }

  return response.json();
}

export type LigneVenteDecision = LigneVenteImport & {
  decision: "VALIDEE" | "REJETEE";
  recetteRetenueId?: number;
};

export async function importerVentes(payload: {
  nomFichierOriginal?: string;
  periodeDebut?: string;
  periodeFin?: string;
  lignes: LigneVenteDecision[];
}): Promise<ResultatImportVentes> {
  const response = await apiFetch(`${API_URL}/ventes/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const corps = await response.json().catch(() => null);
    throw new Error(corps?.error || "Impossible d'importer ce fichier de ventes");
  }

  return response.json();
}

export type DocumentVentesResume = {
  id: number;
  periodeDebut: string | null;
  periodeFin: string | null;
  nomFichierOriginal: string | null;
  importeLe: string;
  creeParIdentifiant: string | null;
  totalLignes: number;
  validees: number;
  rejetees: number;
  enAttente: number;
};

export async function getHistoriqueVentes(): Promise<DocumentVentesResume[]> {
  const response = await apiFetch(`${API_URL}/ventes/documents`);
  if (!response.ok) throw new Error("Impossible de récupérer l'historique des imports de ventes");
  return response.json();
}

export type ReconciliationRecette = {
  recetteId: number;
  recetteNom: string | null;
  quantiteVendue: number;
  chiffreAffairesReel: number | null;
  ventesSansPrix: number;
  coutTheoriqueUnitaire: number | null;
  coutTheoriqueTotal: number | null;
  foodCostTheoriquePct: number | null;
  foodCostReelPct: number | null;
};

export async function getReconciliationVentes(depuis?: string, jusqua?: string): Promise<ReconciliationRecette[]> {
  const params = new URLSearchParams();
  if (depuis) params.set("depuis", depuis);
  if (jusqua) params.set("jusqua", jusqua);
  const suffixe = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(`${API_URL}/ventes/reconciliation${suffixe}`);
  if (!response.ok) throw new Error("Impossible de calculer la réconciliation des ventes");
  const { recettes } = await response.json();
  return recettes;
}

// Miroir de QuadrantMenuEngineering, server/routes/ventes.ts (méthode Kasavana & Smith) : VEDETTE
// (populaire + rentable), CHEVAL_DE_TRAIT (populaire, peu rentable), ENIGME (peu populaire,
// rentable), POIDS_MORT (ni l'un ni l'autre).
export type QuadrantMenuEngineering = "VEDETTE" | "CHEVAL_DE_TRAIT" | "ENIGME" | "POIDS_MORT";

export type ItemMenuEngineering = {
  recetteId: number;
  recetteNom: string;
  quantiteVendue: number;
  margeUnitaire: number;
  prixVenteHT: number;
  coutParPortion: number;
  populaire: boolean;
  rentable: boolean;
  quadrant: QuadrantMenuEngineering;
};

export type ResultatMenuEngineering = {
  items: ItemMenuEngineering[];
  seuilPopulariteQuantite: number | null;
  margeMoyennePonderee: number | null;
  totalQuantiteVendue?: number;
};

export async function getMenuEngineering(depuis?: string, jusqua?: string): Promise<ResultatMenuEngineering> {
  const params = new URLSearchParams();
  if (depuis) params.set("depuis", depuis);
  if (jusqua) params.set("jusqua", jusqua);
  const suffixe = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(`${API_URL}/ventes/menu-engineering${suffixe}`);
  if (!response.ok) throw new Error("Impossible de calculer le menu engineering");
  return response.json();
}
