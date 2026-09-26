import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Pas de solution de repli comme pour JWT_SECRET : sans clé API, cette fonctionnalité précise est
// simplement indisponible (le reste de l'appli fonctionne normalement) — signalé par une erreur
// dédiée que la route transforme en 503 plutôt que de planter au démarrage du serveur.
export class ImportIANonConfigureError extends Error {
  constructor() {
    super("L'import de recette par IA nécessite la variable d'environnement ANTHROPIC_API_KEY");
  }
}

// Distingue une photo mal formée (entrée utilisateur invalide — jamais une panne serveur) de toute
// autre erreur : la route la traite spécifiquement en 400, jamais en 500 générique (voir la
// distinction déjà établie pour P2003/P2025 dans server/utils/erreursEcriture.ts et
// server/routes/mouvements.ts). Discriminée par son type, jamais par le texte du message.
export class PhotoInvalideError extends Error {}

const NIVEAUX_CONFIANCE = ["elevee", "moyenne", "faible"] as const;
export type Confiance = (typeof NIVEAUX_CONFIANCE)[number];

const SECTIONS_ETAPE = ["preparation", "cuisson", "dressage", "autre"] as const;
export type SectionEtape = (typeof SECTIONS_ETAPE)[number];

export type CategorieDetectee = { nom: string; confiance: Confiance };

export type IngredientExtrait = {
  texteOriginal: string;
  nomExtrait: string;
  quantite: number | null;
  unite: string | null;
  precision: string | null;
  confiance: Confiance;
};

export type EtapeExtraite = {
  ordre: number;
  titre: string | null;
  description: string;
  section: SectionEtape;
  dureeMinutes: number | null;
  temperatureC: number | null;
  modeCuisson: string | null;
  pointCritiqueHACCP: boolean;
  controleHACCP: string | null;
  confiance: Confiance;
};

export type MaterielExtrait = {
  texteOriginal: string;
  nomExtrait: string;
  confiance: Confiance;
};

export type ExtractionRecette = {
  nom: string | null;
  categorieDetectee: CategorieDetectee | null;
  sousCategorieDetectee: CategorieDetectee | null;
  portions: number | null;
  poidsPortionG: number | null;
  poidsAccompagnementG: number | null;
  ingredients: IngredientExtrait[];
  etapes: EtapeExtraite[];
  materiel: MaterielExtrait[];
  instructions: string | null;
  alertes: string[];
};

// data:image/jpeg;base64,XXXX -> { mediaType: "image/jpeg", data: "XXXX" }
function parserDataUrlImage(dataUrl: string): { mediaType: string; data: string } {
  const correspondance = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!correspondance) {
    throw new PhotoInvalideError("Format de photo invalide");
  }
  return { mediaType: correspondance[1], data: correspondance[2] };
}

type MediaTypeImage = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const MEDIA_TYPES_IMAGE_ACCEPTES: MediaTypeImage[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export type SourceRecette = { texte: string } | { photoDataUrl: string };

// Extrait, en une seule analyse structurée, l'ensemble des informations d'une recette utilisables
// par la fiche recette (voir la refonte de l'import photo/texte) : nom, catégorie/sous-catégorie
// détectées, portions, poids, ingrédients, étapes classées préparation/cuisson/dressage/autre,
// matériel, notes résiduelles et alertes sur les ambiguïtés — un seul moteur, réutilisé aussi bien
// pour un import de recette complète que pour un complément de recette déjà existante (voir
// ImporterRecetteModal.tsx). Ne fait aucun rapprochement avec les articles de la base (ambigu et
// coûteux à faire faire par le modèle sur un catalogue de plusieurs milliers de références) : ce
// rapprochement est fait ensuite côté client (ligneImportee.ts), qui a déjà la liste des articles
// chargée pour le formulaire de recette.
export async function extraireRecette(
  source: SourceRecette,
  symbolesUnitesDisponibles: string[],
  nomsCategoriesDisponibles: string[],
  nomsSousCategoriesDisponibles: string[]
): Promise<ExtractionRecette> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ImportIANonConfigureError();
  }
  if (symbolesUnitesDisponibles.length === 0) {
    throw new Error("Aucune unité configurée dans l'application");
  }

  const client = new Anthropic();

  const ConfianceSchema = z.enum(NIVEAUX_CONFIANCE);

  // Contraint le nom détecté à l'un des noms exacts déjà existants dans CategorieRecette /
  // SousCategorieRecette (voir la distinction avec la table Categorie des ingrédients) : jamais un
  // libellé inventé par le modèle, exactement comme pour l'unité d'un ingrédient ci-dessous.
  function construireSchemaCategorieDetectee(noms: string[]) {
    return noms.length > 0
      ? z.object({ nom: z.enum(noms as [string, ...string[]]), confiance: ConfianceSchema }).nullable()
      : z.null();
  }

  const IngredientSchema = z.object({
    texteOriginal: z.string().describe("Le texte exact de la ligne d'ingrédient dans le texte d'origine"),
    nomExtrait: z.string().describe("Le nom de l'ingrédient seul, sans quantité ni unité"),
    quantite: z
      .number()
      .nullable()
      .describe("La quantité numérique, ou null si absente ou imprécise (ex. « une pincée »)"),
    unite: z
      .enum(symbolesUnitesDisponibles as [string, ...string[]])
      .nullable()
      .describe("L'unité la plus proche parmi celles proposées, ou null si aucune ne correspond"),
    precision: z
      .string()
      .nullable()
      .describe(
        "Précision qualitative accompagnant la quantité quand elle n'est pas un nombre exploitable " +
          "(ex. « au goût », « environ », « à discrétion »), sinon null. Jamais une valeur inventée."
      ),
    confiance: ConfianceSchema.describe("Fiabilité de cette ligne d'ingrédient telle qu'extraite"),
  });

  const EtapeSchema = z.object({
    ordre: z.number().int().describe("Position de l'étape dans l'ordre du texte, à partir de 1"),
    titre: z.string().nullable().describe("Titre court de l'étape si le document en donne un, sinon null"),
    description: z
      .string()
      .describe(
        "Le texte complet et fidèle de l'étape, sans mention HACCP ajoutée : jamais raccourci ou " +
          "réécrit, même quand température/durée/mode de cuisson sont aussi extraits séparément."
      ),
    section: z
      .enum(SECTIONS_ETAPE)
      .describe(
        "preparation (éplucher, tailler, ciseler, mélanger, assaisonner, mariner, réaliser une " +
          "sauce ou une garniture...), cuisson (mode de cuisson, température, durée, préchauffage, " +
          "cuisson à cœur, repos...), dressage (assemblage, présentation, nappage, disposition, " +
          "finition), ou autre si aucune des trois ne convient clairement."
      ),
    dureeMinutes: z
      .number()
      .nullable()
      .describe("Durée en minutes si explicitement indiquée dans cette étape, sinon null — jamais estimée"),
    temperatureC: z
      .number()
      .nullable()
      .describe("Température en degrés Celsius si explicitement indiquée, sinon null — jamais estimée"),
    modeCuisson: z
      .string()
      .nullable()
      .describe("Mode de cuisson si explicite (four, poêle, vapeur, grill...), sinon null"),
    pointCritiqueHACCP: z
      .boolean()
      .describe(
        "true si cette étape est un point critique pour la sécurité alimentaire (température de " +
          "cuisson à cœur, refroidissement, chaîne du froid, remise en température...), d'après les " +
          "bonnes pratiques d'hygiène habituelles en restauration — pas seulement si le texte source " +
          "le mentionne explicitement"
      ),
    controleHACCP: z
      .string()
      .nullable()
      .describe(
        "Si pointCritiqueHACCP est true : le contrôle à effectuer, avec un seuil chiffré quand la " +
          "pratique standard en donne un (ex. « Cuisson à cœur ≥ 63°C, sonde », « Refroidissement de " +
          "63°C à 10°C en moins de 2h »). Sinon null."
      ),
    confiance: ConfianceSchema.describe("Fiabilité de cette étape telle qu'extraite et classée"),
  });

  const MaterielSchema = z.object({
    texteOriginal: z.string().describe("Le texte exact désignant ce matériel dans le document source"),
    nomExtrait: z.string().describe("Le nom du matériel seul (ex. « thermomètre sonde », « poche à douille »)"),
    confiance: ConfianceSchema,
  });

  const ExtractionSchema = z.object({
    nom: z.string().nullable().describe("Le nom de la recette si identifiable dans le texte, sinon null"),
    categorieDetectee: construireSchemaCategorieDetectee(nomsCategoriesDisponibles).describe(
      nomsCategoriesDisponibles.length > 0
        ? `Catégorie détectée si explicitement identifiable, exclusivement parmi : ${nomsCategoriesDisponibles.join(", ")}. ` +
          "null si absente ou ambiguë — jamais une catégorie inventée ou hors de cette liste."
        : "Aucune catégorie de recette configurée dans l'application"
    ),
    sousCategorieDetectee: construireSchemaCategorieDetectee(nomsSousCategoriesDisponibles).describe(
      nomsSousCategoriesDisponibles.length > 0
        ? `Sous-catégorie détectée si explicitement identifiable, exclusivement parmi : ${nomsSousCategoriesDisponibles.join(", ")}. ` +
          "null si absente ou ambiguë."
        : "Aucune sous-catégorie de recette configurée dans l'application"
    ),
    portions: z.number().nullable().describe("Le nombre de portions ou de personnes si indiqué, sinon null"),
    poidsPortionG: z
      .number()
      .nullable()
      .describe("Poids d'une portion en grammes si explicitement indiqué dans le document, sinon null"),
    poidsAccompagnementG: z
      .number()
      .nullable()
      .describe("Poids de l'accompagnement en grammes si explicitement indiqué, sinon null"),
    ingredients: z.array(IngredientSchema),
    etapes: z.array(EtapeSchema).describe("Les étapes de préparation, une par élément, dans l'ordre du texte"),
    materiel: z
      .array(MaterielSchema)
      .describe("Matériel de cuisine explicitement mentionné dans le document (jamais déduit ou supposé)"),
    instructions: z
      .string()
      .nullable()
      .describe(
        "Texte narratif résiduel non rattachable à un ingrédient ou une étape précise (conseils, " +
          "variantes, origine du plat...), sinon null. Jamais une donnée calculée (coût, prix, " +
          "allergènes, Nutri-Score...) : ces informations ne doivent jamais être extraites."
      ),
    alertes: z
      .array(z.string())
      .describe(
        "Ambiguïtés ou informations manquantes relevées pendant l'extraction, en français, une par " +
          "phrase courte (ex. « Poids d'une portion non indiqué dans le document », « Catégorie " +
          "ambiguë entre Plat et Accompagnement »). Vide si aucune ambiguïté notable."
      ),
  });

  const content: Anthropic.MessageParam["content"] =
    "texte" in source
      ? source.texte
      : (() => {
          const { mediaType, data } = parserDataUrlImage(source.photoDataUrl);
          if (!MEDIA_TYPES_IMAGE_ACCEPTES.includes(mediaType as MediaTypeImage)) {
            throw new PhotoInvalideError("Format de photo non pris en charge (jpeg, png, gif ou webp attendu)");
          }
          return [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as MediaTypeImage, data },
            },
            { type: "text", text: "Voici une photo d'une recette de cuisine." },
          ];
        })();

  const reponse = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 8000,
    output_config: {
      format: zodOutputFormat(ExtractionSchema),
      effort: "medium",
    },
    system:
      "Tu extrais les informations structurées d'une recette de cuisine fournie par l'utilisateur " +
      "(texte collé ou photo), en français, pour produire une fiche recette complète et fidèle au " +
      "document source. Règle absolue : ne jamais inventer une information absente ou ambiguë " +
      "(quantité, ingrédient, température, durée, technique, matériel, catégorie, rendement, " +
      "HACCP...) — utilise null ou une entrée dans alertes plutôt que de deviner, et reflète la " +
      "qualité réelle de chaque information dans son champ confiance. Privilégie toujours la " +
      "fidélité au texte source plutôt que la complétion imaginative. Pour chaque ingrédient, " +
      "choisis l'unité la plus proche parmi celles fournies dans le schéma ; si aucune ne " +
      "correspond vraiment, mets null plutôt que d'en inventer une, et utilise precision pour une " +
      "quantité qualitative non chiffrable (« au goût »...). Le champ nomExtrait ne doit contenir " +
      "que le nom de l'aliment, sans quantité ni unité. Pour chaque étape, conserve son texte " +
      "intégral dans description (jamais raccourci ni réécrit même quand température/durée/mode de " +
      "cuisson sont aussi extraits séparément dans leurs propres champs) et classe-la dans une " +
      "section (preparation/cuisson/dressage/autre) d'après sa nature réelle, pas sa position dans " +
      "le texte. Identifie s'il s'agit d'un point critique pour la sécurité alimentaire (HACCP) " +
      "d'après les bonnes pratiques d'hygiène habituelles en restauration collective (cuisson à " +
      "cœur d'une viande/volaille/poisson, refroidissement rapide après cuisson, remise en " +
      "température, chaîne du froid d'une préparation froide...) — même si le texte source ne le " +
      "mentionne pas explicitement — et propose un contrôle avec un seuil chiffré quand la pratique " +
      "standard en donne un. Ne signale un matériel que s'il est explicitement mentionné dans le " +
      "document, jamais déduit d'une technique. La catégorie et la sous-catégorie détectées doivent " +
      "obligatoirement être choisies parmi les noms exacts fournis dans le schéma, ou null si aucune " +
      "ne correspond clairement à une confiance suffisante.",
    messages: [{ role: "user", content }],
  });

  if (!reponse.parsed_output) {
    throw new Error("Impossible d'analyser cette recette");
  }

  return reponse.parsed_output;
}
