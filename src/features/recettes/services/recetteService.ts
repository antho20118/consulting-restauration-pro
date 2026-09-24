import { API_URL, apiFetch } from "../../../config/api";
import type {
  AliasIngredient,
  AnalyseConsulting,
  ArticleRecette,
  DecisionImportExcel,
  EvaluationHACCP,
  ExtractionRecette,
  Recette,
  RecetteInput,
  RecettePourCorrespondance,
  ReponseImportExcel,
  SuggestionFournisseur,
  UniteRecette,
} from "../types/recette";

export async function getRecettes(): Promise<Recette[]> {
  const response = await apiFetch(`${API_URL}/recettes`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les recettes");
  }

  return response.json();
}

// Toutes les recettes (actives ET inactives) pour la correspondance de l'import Excel sécurisé —
// voir GET /toutes-pour-correspondance (server/routes/recettes.ts) : une recette inactive doit
// pouvoir être reconnue sans jamais être réactivée automatiquement.
export async function getRecettesPourCorrespondance(): Promise<RecettePourCorrespondance[]> {
  const response = await apiFetch(`${API_URL}/recettes/toutes-pour-correspondance`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les recettes pour la correspondance");
  }

  return response.json();
}

// Une recette précise, active ou inactive (contrairement à getRecettes ci-dessus, limitée aux
// recettes actives) : sert à charger le détail complet (étapes, HACCP, notes, photo) d'une
// recette reconnue par l'import Excel sécurisé, pour le bloc « CONSERVÉ » de son aperçu.
export async function getRecetteDetail(id: number): Promise<Recette> {
  const response = await apiFetch(`${API_URL}/recettes/${id}`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer cette recette");
  }

  return response.json();
}

// simulate: true -> aperçu de coût (voir POST /import-excel côté serveur : transaction réellement
// exécutée via calculerCoutRecette puis systématiquement annulée, jamais conservée). simulate
// omis ou false -> import réel, conservé dans une seule transaction, tout ou rien.
export async function importerRecettesExcel(
  decisions: DecisionImportExcel[],
  simulate = false
): Promise<ReponseImportExcel> {
  const response = await apiFetch(`${API_URL}/recettes/import-excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisions, simulate }),
  });

  if (!response.ok) {
    throw new Error("Impossible de finaliser l'import (aucune modification conservée)");
  }

  return response.json();
}

export async function creerRecette(
  input: RecetteInput & { societeId: number }
): Promise<Recette> {
  const response = await apiFetch(`${API_URL}/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de créer la recette");
  }

  return response.json();
}

export async function modifierRecette(id: number, input: RecetteInput): Promise<Recette> {
  const response = await apiFetch(`${API_URL}/recettes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error("Impossible de modifier la recette");
  }

  return response.json();
}

export async function supprimerRecette(id: number): Promise<void> {
  const response = await apiFetch(`${API_URL}/recettes/${id}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error("Impossible de supprimer la recette");
  }
}

export async function supprimerToutesLesRecettes(): Promise<number> {
  const response = await apiFetch(`${API_URL}/recettes`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error("Impossible de supprimer les recettes");
  }

  const data = await response.json();
  return data.supprimees;
}

export async function getArticlesDisponibles(): Promise<ArticleRecette[]> {
  const response = await apiFetch(`${API_URL}/articles`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les articles");
  }

  return response.json();
}

export async function getSuggestionsEconomie(recetteId: number): Promise<SuggestionFournisseur[]> {
  const response = await apiFetch(`${API_URL}/recettes/${recetteId}/suggestions-economie`);

  if (!response.ok) {
    throw new Error("Impossible de calculer les suggestions d'économies");
  }

  return response.json();
}

export async function getEvaluationHACCP(recetteId: number): Promise<EvaluationHACCP> {
  const response = await apiFetch(`${API_URL}/haccp/evaluer/${recetteId}`);

  if (!response.ok) {
    throw new Error("Impossible d'évaluer les points HACCP de la recette");
  }

  return response.json();
}

// Analyse déterministe de l'agent Consulting (voir server/routes/consulting.ts) — a minima
// branchée ici pour ses alertes (food cost, tarif manquant, HACCP à valider), qui n'existaient
// nulle part ailleurs dans l'interface avant ce correctif.
export async function getAnalyseConsulting(recetteId: number): Promise<AnalyseConsulting> {
  const response = await apiFetch(`${API_URL}/consulting/analyser-recette`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recetteId }),
  });

  if (!response.ok) {
    throw new Error("Impossible d'analyser la recette");
  }

  return response.json();
}

// Porte le statut HTTP pour permettre à l'appelant de distinguer "IA non configurée" (503, à
// traiter par un repli local) d'une vraie erreur (message affiché tel quel), sans dépendre du
// texte du message qui pourrait changer ou être traduit.
export class ErreurImportIA extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function importerRecetteIA(
  source: { texte: string } | { photoDataUrl: string }
): Promise<ExtractionRecette> {
  const response = await apiFetch(`${API_URL}/recettes/import-ia`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(source),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ErreurImportIA(data?.error ?? "Impossible d'analyser cette recette", response.status);
  }

  return data;
}

export async function getUnitesDisponibles(): Promise<UniteRecette[]> {
  const response = await apiFetch(`${API_URL}/unites`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les unités");
  }

  return response.json();
}

// Correspondances "texte d'ingrédient -> article" déjà validées par l'utilisateur lors d'un
// import précédent (voir ImporterRecetteModal.tsx) : consultées avant la recherche approximative
// habituelle pour retrouver directement le bon article.
export async function getAliasIngredients(): Promise<AliasIngredient[]> {
  const response = await apiFetch(`${API_URL}/alias-ingredients`);

  if (!response.ok) {
    throw new Error("Impossible de récupérer les correspondances d'ingrédients");
  }

  return response.json();
}

// Mémorise les correspondances choisies pour les lignes issues d'un import (voir
// RecetteForm.tsx) : n'échoue jamais bruyamment pour l'utilisateur, la recette elle-même est déjà
// enregistrée à ce stade — seule la mémoire de correspondance ne serait pas mise à jour cette fois.
export async function enregistrerAliasIngredients(
  correspondances: { texte: string; articleId: number }[]
): Promise<void> {
  if (correspondances.length === 0) return;

  await apiFetch(`${API_URL}/alias-ingredients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correspondances }),
  }).catch(() => undefined);
}

export type ArticleTrouveParReference = {
  reference: string;
  articleId: number;
  nom: string;
  uniteId: number;
  prixHT: number;
};

// Rapprochement exact par code article (voir ImporterFichierCoutsModal.tsx) : pour un import de
// fichier de coûts, où l'on veut retrouver l'article précis désigné par son code plutôt qu'une
// approximation par nom.
export async function rechercherArticlesParReferences(
  references: string[]
): Promise<ArticleTrouveParReference[]> {
  if (references.length === 0) return [];

  const response = await apiFetch(`${API_URL}/articles/rechercher-par-reference`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ references }),
  });

  if (!response.ok) {
    throw new Error("Impossible de rapprocher les codes articles");
  }

  const data = await response.json();
  return data.trouves;
}
