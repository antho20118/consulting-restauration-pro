// Extraction par vision IA d'une étiquette alimentaire (liste d'ingrédients + tableau de valeurs
// nutritionnelles) photographiée — même mécanisme que server/utils/importRecetteIA.ts (Anthropic,
// schéma Zod structuré), réutilisé sans modifier ce fichier (zéro régression garantie par
// construction en ne touchant jamais aux fichiers déjà éprouvés). Erreurs réutilisées telles
// quelles (ImportIANonConfigureError, PhotoInvalideError) pour que la route mappe les mêmes codes
// HTTP que /recettes/import-ia — dont le repli gratuit (OCR + analyse par règles côté client,
// déclenché sur le même 503) est le même principe ici, voir analyseNutritionLocale.ts.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { ImportIANonConfigureError, PhotoInvalideError, type Confiance } from "./importRecetteIA.js";

export { ImportIANonConfigureError, PhotoInvalideError };

const NIVEAUX_CONFIANCE = ["elevee", "moyenne", "faible"] as const;

type MediaTypeImage = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const MEDIA_TYPES_IMAGE_ACCEPTES: MediaTypeImage[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function parserDataUrlImage(dataUrl: string): { mediaType: string; data: string } {
  const correspondance = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!correspondance) {
    throw new PhotoInvalideError("Format de photo invalide");
  }
  return { mediaType: correspondance[1], data: correspondance[2] };
}

export type AllergeneDetecte = { code: string; confiance: Confiance };

// Mêmes 8 champs, même unité ("pour 100 g/100 mL") que ValeurNutritionnelle (prisma/schema.prisma)
// et CHAMPS_NUTRITION (src/features/ingredients/components/IngredientForm.tsx) — jamais une autre
// base (portion, paquet entier) sans conversion sûre, voir le system prompt ci-dessous.
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

export type SourceNutrition = { texte: string } | { photoDataUrl: string };

// Extrait, en une seule analyse structurée, les allergènes réglementaires présents et les valeurs
// nutritionnelles pour 100 g/100 mL d'une étiquette alimentaire (texte collé ou photo). Contraint
// les allergènes détectés aux codes réellement configurés dans l'application (jamais un code
// inventé), même principe que categorieDetectee dans extraireRecette.
export async function extraireAllergenesNutrition(
  source: SourceNutrition,
  allergenesDisponibles: { code: string; nom: string }[]
): Promise<ExtractionNutrition> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ImportIANonConfigureError();
  }
  if (allergenesDisponibles.length === 0) {
    throw new Error("Aucun allergène configuré dans l'application");
  }

  const client = new Anthropic();
  const ConfianceSchema = z.enum(NIVEAUX_CONFIANCE);
  const codes = allergenesDisponibles.map((a) => a.code) as [string, ...string[]];

  const AllergeneDetecteSchema = z.object({
    code: z.enum(codes).describe("Le code exact de l'allergène détecté, exclusivement parmi ceux fournis"),
    confiance: ConfianceSchema.describe(
      "Fiabilité de cette détection — plus faible pour une mention de traces possibles que pour " +
        "une présence directe dans la liste d'ingrédients"
    ),
  });

  const ExtractionSchema = z.object({
    allergenesDetectes: z
      .array(AllergeneDetecteSchema)
      .describe(
        "Un élément par allergène réglementaire identifié (présence directe ou mention de traces), " +
          "jamais deux fois le même code. Vide si aucun n'est identifiable dans le document."
      ),
    nutrition: z.object({
      energie: z.number().nullable().describe("Énergie en kcal pour 100 g/100 mL, ou null si absente"),
      proteines: z.number().nullable().describe("Protéines en grammes pour 100 g/100 mL, ou null si absentes"),
      glucides: z.number().nullable().describe("Glucides en grammes pour 100 g/100 mL, ou null si absents"),
      sucres: z.number().nullable().describe("Dont sucres, en grammes pour 100 g/100 mL, ou null si absent"),
      lipides: z.number().nullable().describe("Lipides en grammes pour 100 g/100 mL, ou null si absents"),
      acidesGrasSatures: z
        .number()
        .nullable()
        .describe("Dont acides gras saturés, en grammes pour 100 g/100 mL, ou null si absent"),
      fibres: z.number().nullable().describe("Fibres alimentaires en grammes pour 100 g/100 mL, ou null si absentes"),
      sel: z
        .number()
        .nullable()
        .describe("Sel en grammes pour 100 g/100 mL, ou null si absent (jamais reconstitué depuis le sodium)"),
    }),
    alertes: z
      .array(z.string())
      .describe(
        "Ambiguïtés relevées pendant l'extraction, en français, une par phrase courte (ex. « Valeurs " +
          "données pour une portion de 30 g, non pour 100 g », « Texte partiellement illisible », " +
          "« Mention de traces de fruits à coque incertaine »). Vide si aucune ambiguïté notable."
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
            { type: "image", source: { type: "base64", media_type: mediaType as MediaTypeImage, data } },
            {
              type: "text",
              text: "Voici une photo d'une étiquette alimentaire (liste d'ingrédients et/ou tableau de valeurs nutritionnelles).",
            },
          ];
        })();

  const listeAllergenes = allergenesDisponibles.map((a) => `${a.code} (${a.nom})`).join(", ");

  const reponse = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 8000,
    output_config: {
      format: zodOutputFormat(ExtractionSchema),
      effort: "medium",
    },
    system:
      "Tu extrais les informations structurées d'une étiquette alimentaire fournie par l'utilisateur " +
      "(texte collé ou photo), en français, pour compléter une fiche ingrédient. Règle absolue : ne " +
      "jamais inventer une valeur ou un allergène absent ou ambigu du document — utilise null, une " +
      "liste vide, ou une entrée dans alertes plutôt que de deviner. Les allergènes détectés " +
      `doivent obligatoirement être choisis parmi les codes exacts suivants : ${listeAllergenes} — ` +
      "jamais un code hors de cette liste, et jamais un allergène déduit d'une simple ressemblance " +
      "de nom d'ingrédient sans que le texte le confirme réellement (ex. ne pas supposer qu'un " +
      "ingrédient contient du gluten sans mention explicite). Une mention « peut contenir des " +
      "traces de X » compte comme une détection, mais avec une confiance plus faible qu'une " +
      "présence directe dans la liste d'ingrédients. Les valeurs nutritionnelles doivent être pour " +
      "100 g ou 100 mL exclusivement ; si le document ne donne que des valeurs par portion ou par " +
      "paquet entier, ne les convertis que si le poids de référence est indiqué sans ambiguïté, " +
      "sinon laisse les champs à null et signale-le dans alertes.",
    messages: [{ role: "user", content }],
  });

  if (!reponse.parsed_output) {
    throw new Error("Impossible d'analyser cette étiquette");
  }

  return reponse.parsed_output;
}
