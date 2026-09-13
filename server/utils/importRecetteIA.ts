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

export type IngredientExtrait = {
  texteOriginal: string;
  nomExtrait: string;
  quantite: number | null;
  unite: string | null;
};

export type ExtractionRecette = {
  nom: string | null;
  portions: number | null;
  ingredients: IngredientExtrait[];
  etapes: string[];
};

// data:image/jpeg;base64,XXXX -> { mediaType: "image/jpeg", data: "XXXX" }
function parserDataUrlImage(dataUrl: string): { mediaType: string; data: string } {
  const correspondance = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!correspondance) {
    throw new Error("Format de photo invalide");
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

// Extrait le nom, les portions, les ingrédients (avec quantité/unité) et les étapes d'une recette
// fournie soit comme texte collé librement, soit comme photo (recette manuscrite, page de livre,
// capture d'écran…). Ne fait aucun rapprochement avec les articles de la base (ambigu et coûteux à
// faire faire par le modèle sur un catalogue de plusieurs milliers de références) : ce
// rapprochement est fait ensuite côté client, qui a déjà la liste des articles chargée pour le
// formulaire de recette.
export async function extraireRecette(
  source: SourceRecette,
  symbolesUnitesDisponibles: string[]
): Promise<ExtractionRecette> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ImportIANonConfigureError();
  }
  if (symbolesUnitesDisponibles.length === 0) {
    throw new Error("Aucune unité configurée dans l'application");
  }

  const client = new Anthropic();

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
  });

  const ExtractionSchema = z.object({
    nom: z.string().nullable().describe("Le nom de la recette si identifiable dans le texte, sinon null"),
    portions: z.number().nullable().describe("Le nombre de portions ou de personnes si indiqué, sinon null"),
    ingredients: z.array(IngredientSchema),
    etapes: z.array(z.string()).describe("Les étapes de préparation, une par élément, dans l'ordre du texte"),
  });

  const content: Anthropic.MessageParam["content"] =
    "texte" in source
      ? source.texte
      : (() => {
          const { mediaType, data } = parserDataUrlImage(source.photoDataUrl);
          if (!MEDIA_TYPES_IMAGE_ACCEPTES.includes(mediaType as MediaTypeImage)) {
            throw new Error("Format de photo non pris en charge (jpeg, png, gif ou webp attendu)");
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
      "(texte collé ou photo), en français. Pour chaque ingrédient, choisis l'unité la plus proche " +
      "parmi celles fournies dans le schéma ; si aucune ne correspond vraiment, mets null plutôt que " +
      "d'en inventer une. Le champ nomExtrait ne doit contenir que le nom de l'aliment, sans quantité " +
      "ni unité.",
    messages: [{ role: "user", content }],
  });

  if (!reponse.parsed_output) {
    throw new Error("Impossible d'analyser cette recette");
  }

  return reponse.parsed_output;
}
