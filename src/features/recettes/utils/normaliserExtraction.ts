import type { EtapeExtraite, ExtractionRecette, IngredientExtrait, MaterielExtrait } from "../types/recette";

// Couche de normalisation déterministe appliquée après extraction (IA ou repli local sans IA),
// avant tout rapprochement d'article ou affichage — voir le chantier « import photo : rendu
// professionnel ». Ne réinterprète jamais le sens d'une donnée (aucun reclassement
// ingrédient/technique, aucune quantité ni unité devinée : ce serait de l'invention, interdite par
// les deux moteurs d'extraction eux-mêmes) : corrige uniquement des défauts mécaniques de forme
// communs aux deux chemins — ponctuation de mise en page résiduelle, lignes vides, doublons de
// lecture (OCR ou double passage), ordre des étapes.

// Retire une ponctuation de puce/tiret résiduelle en tête ou fin de texte, jamais à l'intérieur
// (« crème brûlée » reste intact). Volontairement plus restreint que la ponctuation déjà tolérée
// par analyseRecetteLocale.ts (qui, elle, lit des LIGNES brutes) : ici, le texte est déjà un champ
// structuré (nomExtrait/description), donc une virgule ou un tiret interne fait partie de la
// donnée, pas de sa mise en forme.
function nettoyerTexte(texte: string): string {
  return texte
    .replace(/^[\s\-–—•*·]+/, "")
    .replace(/[\s\-–—]+$/, "")
    .trim();
}

function normaliserIngredients(ingredients: IngredientExtrait[]): IngredientExtrait[] {
  const dejaVus = new Set<string>();
  const resultat: IngredientExtrait[] = [];
  for (const ingredient of ingredients) {
    const nomExtrait = nettoyerTexte(ingredient.nomExtrait);
    if (!nomExtrait) continue; // ligne vide résiduelle après nettoyage : jamais un ingrédient fantôme
    const nettoye = { ...ingredient, nomExtrait };
    const cle = `${nomExtrait.toLowerCase()}|${nettoye.quantite ?? ""}|${nettoye.unite ?? ""}`;
    if (dejaVus.has(cle)) continue; // doublon de lecture (photo/OCR), pas un second ingrédient réel
    dejaVus.add(cle);
    resultat.push(nettoye);
  }
  return resultat;
}

function normaliserMateriel(materiel: MaterielExtrait[]): MaterielExtrait[] {
  const dejaVus = new Set<string>();
  const resultat: MaterielExtrait[] = [];
  for (const item of materiel) {
    const nomExtrait = nettoyerTexte(item.nomExtrait);
    if (!nomExtrait) continue;
    const cle = nomExtrait.toLowerCase();
    if (dejaVus.has(cle)) continue;
    dejaVus.add(cle);
    resultat.push({ ...item, nomExtrait });
  }
  return resultat;
}

function normaliserEtapes(etapes: EtapeExtraite[]): EtapeExtraite[] {
  const dejaVues = new Set<string>();
  const filtrees: EtapeExtraite[] = [];
  for (const etape of etapes) {
    const description = nettoyerTexte(etape.description);
    if (!description) continue;
    const cle = description.toLowerCase();
    if (dejaVues.has(cle)) continue;
    dejaVues.add(cle);
    filtrees.push({ ...etape, description });
  }
  // Toujours une séquence 1..N contiguë après filtrage — jamais les numéros bruts d'origine
  // (potentiellement absents, dupliqués ou mal lus), déjà le principe suivi par
  // analyseRecetteLocale.ts, appliqué ici aussi après suppression d'éventuels doublons.
  return filtrees.map((etape, index) => ({ ...etape, ordre: index + 1 }));
}

export function normaliserExtraction(extraction: ExtractionRecette): ExtractionRecette {
  return {
    ...extraction,
    ingredients: normaliserIngredients(extraction.ingredients),
    etapes: normaliserEtapes(extraction.etapes),
    materiel: normaliserMateriel(extraction.materiel),
  };
}
