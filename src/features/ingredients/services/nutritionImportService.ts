import { API_URL, apiFetch } from "../../../config/api";

// Miroir exact de server/utils/importNutritionIA.ts (ExtractionNutrition) — mêmes 8 champs que
// ValeursNutritionnelles (types/ingredient.ts), plus les allergènes détectés (par code, jamais par
// id : le code est stable, l'id dépend de l'ordre d'insertion en base) et des alertes en texte
// libre sur les ambiguïtés relevées pendant l'extraction.
export type ConfianceExtraction = "elevee" | "moyenne" | "faible";

export type AllergeneDetecte = { code: string; confiance: ConfianceExtraction };

export type NutritionExtraite = {
  energie: number | null;
  proteines: number | null;
  glucides: number | null;
  sucres: number | null;
  lipides: number | null;
  acidesGrasSatures: number | null;
  fibres: number | null;
  sel: number | null;
};

export type ExtractionNutrition = {
  allergenesDetectes: AllergeneDetecte[];
  nutrition: NutritionExtraite;
  alertes: string[];
};

export class ErreurImportNutritionIA extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function importerAllergenesNutritionIA(
  source: { texte: string } | { photoDataUrl: string }
): Promise<ExtractionNutrition> {
  const response = await apiFetch(`${API_URL}/articles/import-nutrition-ia`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(source),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ErreurImportNutritionIA(data?.error ?? "Impossible d'analyser cette étiquette", response.status);
  }

  return data;
}
