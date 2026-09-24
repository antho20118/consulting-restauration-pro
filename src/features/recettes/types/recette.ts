export interface UniteRecette {
  id: number;
  nom: string;
  symbole: string;
  facteurBase: number;
}

export interface AllergeneRecette {
  id: number;
  nom: string;
}

// Reflète l'enum Prisma TypeArticle (server/prisma/schema.prisma) — PETIT_MATERIEL est le seul
// type utilisé pour le rapprochement du matériel détecté à l'import (voir construireMaterielImporte
// dans ligneImportee.ts) : aucun des autres types n'a de sens comme "matériel de cuisine".
export type TypeArticle =
  | "MATIERE_PREMIERE"
  | "SOUS_RECETTE"
  | "PRODUIT_FINI"
  | "EMBALLAGE"
  | "CONSOMMABLE"
  | "ENTRETIEN"
  | "PETIT_MATERIEL";

export interface ArticleRecette {
  id: number;
  nom: string;
  reference: string | null;
  rendement: number;
  type: TypeArticle;
  tarifs: {
    prixHT: number;
    quantiteConditionnement: number;
    unite: { symbole: string; facteurBase: number };
    fournisseur: { id: number; nom: string };
  }[];
  allergenes: { allergene: AllergeneRecette }[];
}

export interface LigneRecette {
  id: number;
  articleId: number;
  quantite: number;
  uniteId: number;
  gainCuissonPct: number;
  unite: UniteRecette;
  article: ArticleRecette;
  coutLigne: number;
  poidsFiniLigneG: number;
}

export interface EtapeRecette {
  id: number;
  description: string;
  pointCritiqueHACCP: boolean;
  controleHACCP: string | null;
}

export interface Recette {
  id: number;
  nom: string;
  instructions: string | null;
  photo: string | null;
  categorieId: number | null;
  categorie: { id: number; nom: string } | null;
  sousCategorieId: number | null;
  sousCategorie: { id: number; nom: string } | null;
  portions: number;
  poidsPortionG: number | null;
  poidsAccompagnementG: number | null;
  prixVenteHT: number | null;
  lignes: LigneRecette[];
  etapes: EtapeRecette[];
  allergenes: AllergeneRecette[];
  coutTotal: number;
  coutParPortion: number;
  foodCostPct: number | null;
  margeHT: number | null;
  poidsFiniTotalG: number;
}

export type LigneRecetteInput = {
  articleId: number;
  // false uniquement pour un article rapproché automatiquement à l'import (IA/OCR) et pas encore
  // revu par l'utilisateur dans le formulaire — voir construireLigneImportee() dans
  // ligneImportee.ts et l'audit qui a motivé ce champ (un rapprochement automatique ne doit
  // jamais avoir l'air d'un choix humain confirmé, en particulier pour les allergènes qui en
  // dépendent). true pour une ligne ajoutée manuellement (rien d'automatique à signaler) et pour
  // une ligne d'une recette déjà enregistrée (déjà validée une première fois lors de cet
  // enregistrement). Purement local au formulaire : jamais envoyé au serveur.
  articleConfirme: boolean;
  quantite: number;
  uniteId: number;
  gainCuissonPct: number;
  // Texte d'ingrédient d'origine (avant rapprochement avec le catalogue), renseigné uniquement
  // pour une ligne issue d'un import texte/photo — sert à mémoriser la correspondance choisie par
  // l'utilisateur à l'enregistrement de la recette (voir RecetteForm.tsx), jamais envoyé tel quel
  // à la création/modification de la recette elle-même.
  texteIngredientImporte?: string;
};

export interface AliasIngredient {
  texteNormalise: string;
  articleId: number;
}

export type EtapeRecetteInput = {
  description: string;
  pointCritiqueHACCP: boolean;
  controleHACCP: string | null;
};

// Reflète la fiabilité réelle d'une information extraite (jamais devinée) — voir la règle absolue
// de non-invention (audit refonte import IA) : sert à décider, dans la prévisualisation, ce qui
// peut être accepté d'un simple coup d'œil et ce qui doit attirer l'attention avant validation.
export type Confiance = "elevee" | "moyenne" | "faible";

// Classification purement destinée à regrouper les étapes dans la prévisualisation (voir
// PrevisualisationImportRecette.tsx) : n'existe dans aucune colonne Prisma (RecetteEtape n'a pas
// de champ "section") — au moment de l'enregistrement, seul le texte intégral de l'étape
// (description) est conservé, exactement comme une étape ajoutée manuellement.
export type SectionEtape = "preparation" | "cuisson" | "dressage" | "autre";

export interface CategorieDetectee {
  nom: string;
  confiance: Confiance;
}

export interface IngredientExtrait {
  texteOriginal: string;
  nomExtrait: string;
  quantite: number | null;
  unite: string | null;
  // Précision qualitative accompagnant la quantité quand le document en donne une, sans qu'elle
  // soit exploitable comme un nombre (ex. "au goût", "environ", "à discrétion") — jamais fabriquée
  // si absente du texte source.
  precision: string | null;
  confiance: Confiance;
}

export interface EtapeExtraite {
  ordre: number;
  titre: string | null;
  // Texte intégral de l'étape tel qu'il apparaît dans le document source — jamais remplacé ni
  // tronqué par les champs structurés ci-dessous (dureeMinutes/temperatureC/modeCuisson), qui ne
  // servent qu'à aider la prévisualisation, pas à s'y substituer.
  description: string;
  section: SectionEtape;
  dureeMinutes: number | null;
  temperatureC: number | null;
  modeCuisson: string | null;
  pointCritiqueHACCP: boolean;
  controleHACCP: string | null;
  confiance: Confiance;
}

export interface MaterielExtrait {
  texteOriginal: string;
  nomExtrait: string;
  confiance: Confiance;
}

export interface ExtractionRecette {
  nom: string | null;
  categorieDetectee: CategorieDetectee | null;
  sousCategorieDetectee: CategorieDetectee | null;
  portions: number | null;
  poidsPortionG: number | null;
  poidsAccompagnementG: number | null;
  ingredients: IngredientExtrait[];
  etapes: EtapeExtraite[];
  materiel: MaterielExtrait[];
  // Texte narratif résiduel, non rattachable à une étape ou un ingrédient précis (ex. conseils,
  // variantes, origine de la recette) — destiné à Recette.instructions, jamais aux champs calculés.
  instructions: string | null;
  // Ambiguïtés relevées pendant l'extraction (quantité absente, unité incertaine, catégorie
  // ambiguë...) — affichées telles quelles dans la prévisualisation, jamais résolues silencieusement.
  alertes: string[];
}

// Rapprochement d'un élément de matériel détecté avec le catalogue d'articles, restreint à
// TypeArticle.PETIT_MATERIEL (voir construireMaterielImporte dans ligneImportee.ts) — même logique
// que LigneRecetteInput.articleConfirme pour les ingrédients : jamais un rapprochement automatique
// qui aurait l'air d'un choix humain déjà confirmé.
export type MaterielImporteInput = {
  articleId: number;
  articleConfirme: boolean;
  confiance: Confiance;
  texteMaterielImporte: string;
};

// Résultat de la validation humaine d'une prévisualisation d'import (voir
// PrevisualisationImportRecette.tsx), appliqué à une recette déjà ouverte dans RecetteForm — jamais
// à la création, qui repart d'un brouillon complet (voir BrouillonRecette dans RecetteForm.tsx).
// Chaque champ scalaire n'est présent que si l'utilisateur a explicitement choisi de l'appliquer :
// un champ absent laisse la valeur actuelle du formulaire intacte (aucun écrasement silencieux).
export type PatchImportRecette = {
  nom?: string;
  categorieId?: number | null;
  sousCategorieId?: number | null;
  portions?: number;
  poidsPortionG?: number;
  poidsAccompagnementG?: number;
  lignesAjoutees?: LigneRecetteInput[];
  etapesAjoutees?: EtapeRecetteInput[];
  instructionsAjoutees?: string;
};

// Détection par mots-clés sur la description d'une étape (voir server/utils/haccp.ts) — une
// suggestion, jamais une preuve de conformité.
export interface RegleHACCP {
  code: string;
  nom: string;
  risque: string;
  mesurePreventive: string;
  limiteCritique: string;
  surveillance: string;
  actionCorrective: string;
}

// Résultat de l'évaluation HACCP d'une étape : aValider tient compte à la fois de la détection par
// mots-clés (reglesDetectees) et du signal humain explicite (pointCritiqueHACCP), l'un ou l'autre
// suffisant à exiger un contrôle documenté (controleHACCP non vide).
export interface EtapeEvalueeHACCP {
  id: number;
  reglesDetectees: RegleHACCP[];
  aValider: boolean;
}

export interface EvaluationHACCP {
  recetteId: number;
  recetteNom: string;
  etapes: EtapeEvalueeHACCP[];
}

// Analyse déterministe de l'agent Consulting (voir server/routes/consulting.ts) : aucun appel à un
// modèle de langage, seulement les mêmes indicateurs et la même évaluation HACCP que le reste de
// l'application, plus des alertes calculées à partir de règles en dur. `indicateurs` reprend des
// champs déjà présents sur `Recette` (coutTotal, coutParPortion, foodCostPct...) — la valeur
// propre à cet appel est `alertes` (et `simulation`), disponibles nulle part ailleurs dans l'app.
export interface AnalyseConsulting {
  recetteId: number;
  recetteNom: string;
  indicateurs: {
    coutTotal: number;
    coutParPortion: number;
    foodCostPct: number | null;
    margeHT: number | null;
    poidsFiniTotalG: number;
  };
  // Non null uniquement quand foodCostPct est null (pas de prix de vente réel) ET qu'un
  // coefficient multiplicateur est configuré pour la société — jamais un vrai prix de vente,
  // toujours une estimation. À afficher avec une étiquette explicite, jamais avec la même mise en
  // forme qu'une donnée réelle (voir AlertesConsulting.tsx).
  simulation: { coefficient: number; prixVenteEstimeHT: number; foodCostTheoriquePct: number } | null;
  alertes: string[];
  haccp: EtapeEvalueeHACCP[];
}

// Changement de fournisseur pour un même article déjà utilisé dans la recette — jamais un
// remplacement d'un article par un autre (voir server/utils/suggestionsEconomie.ts).
export interface SuggestionFournisseur {
  ligneId: number;
  article: { id: number; nom: string };
  fournisseurActuel: { id: number; nom: string };
  fournisseurAlternatif: { id: number; nom: string };
  prixActuelParUniteBase: number;
  prixAlternatifParUniteBase: number;
  uniteBase: string;
  conditionnementActuel: { nom: string; quantiteConditionnement: number; uniteSymbole: string };
  conditionnementAlternatif: { nom: string; quantiteConditionnement: number; uniteSymbole: string };
  economieEuros: number;
  economiePct: number;
  nouveauFoodCostPct: number | null;
}

// Pré-remplissage optionnel utilisé uniquement à la création (ex. depuis la prévisualisation
// d'import) : contrairement à `recette` sur RecetteForm, sa présence ne déclenche jamais une
// modification (PUT) plutôt qu'une création (POST).
export type BrouillonRecette = {
  nom?: string;
  categorieId?: number | null;
  sousCategorieId?: number | null;
  portions?: number;
  poidsPortionG?: number;
  poidsAccompagnementG?: number;
  instructions?: string;
  lignes?: LigneRecetteInput[];
  etapes?: EtapeRecetteInput[];
};

export type RecetteInput = {
  nom: string;
  categorieId: number | null;
  sousCategorieId: number | null;
  portions: number;
  poidsPortionG: number | null;
  poidsAccompagnementG: number | null;
  prixVenteHT: number | null;
  instructions: string | null;
  photo: string | null;
  lignes: LigneRecetteInput[];
  etapes: EtapeRecetteInput[];
};

// Import Excel sécurisé (voir ImporterRecettesExcelSecuriseModal.tsx) : une recette existante
// n'est jamais renvoyée entièrement (nom, étapes, HACCP, notes, photo...), seules ses nouvelles
// lignes d'ingrédients sont transmises — POST /api/recettes/import-excel ne touche donc jamais à
// autre chose que RecetteLigne pour une mise à jour (voir server/routes/recettes.ts).
export type LigneImportExcel = { articleId: number; quantite: number; uniteId: number; gainCuissonPct?: number };

export type DecisionImportExcel =
  | {
      action: "creer";
      nom: string;
      categorieId: number | null;
      sousCategorieId: number | null;
      societeId: number;
      lignes: LigneImportExcel[];
    }
  | { action: "mettre_a_jour"; recetteId: number; lignes: LigneImportExcel[] };

export type ResultatDecisionImportExcel = { action: DecisionImportExcel["action"]; recette: Recette };

// simulate: true -> aperçu de coût calculé via une transaction réellement exécutée puis annulée
// (voir POST /import-excel, server/routes/recettes.ts) : resultats reflète calculerCoutRecette
// mais rien n'a été conservé en base. simulate: false -> import réel, effectivement conservé.
export type ReponseImportExcel = { simulate: boolean; resultats: ResultatDecisionImportExcel[] };

export type RecettePourCorrespondance = { id: number; nom: string; actif: boolean };
