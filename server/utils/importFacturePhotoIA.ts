// Extraction par vision IA d'une facture fournisseur photographiée — même mécanisme que
// importListingPhotoIA.ts (Phase 4), enrichi des métadonnées propres à une facture (numéro, date,
// montant total). Erreurs réutilisées telles quelles (ImportIANonConfigureError, PhotoInvalideError)
// pour que la route mappe les mêmes codes HTTP que /listings-fournisseur/import-ia et
// /recettes/import-ia.
//
// Ne fait aucun rapprochement avec les articles existants (voir rapprochementFournisseur.ts,
// appelé séparément par la route) et ne détecte aucun doublon (voir listingsFournisseur.ts) :
// produit uniquement des données niveau A, jamais une proposition ni une décision.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { ImportIANonConfigureError, PhotoInvalideError } from "./importRecetteIA.js";
import type { LigneListingExtraite } from "./importListingPhotoIA.js";

export { ImportIANonConfigureError, PhotoInvalideError };

type MediaTypeImage = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const MEDIA_TYPES_IMAGE_ACCEPTES: MediaTypeImage[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function parserDataUrlImage(dataUrl: string): { mediaType: string; data: string } {
  const correspondance = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!correspondance) {
    throw new PhotoInvalideError("Format de photo invalide");
  }
  return { mediaType: correspondance[1], data: correspondance[2] };
}

export type FactureExtraite = {
  numero: string | null;
  // Chaîne brute (ex. "15/03/2026"), jamais convertie ici — la conversion en Date se fait côté
  // route au moment de la persistance, pour ne jamais faire porter cette responsabilité à
  // l'extraction elle-même (même principe que le prix, non converti pendant l'extraction).
  dateDocument: string | null;
  montantTotal: number | null;
  lignes: LigneListingExtraite[];
};

const LigneFactureSchema = z.object({
  designation: z.string().describe("La désignation du produit telle qu'écrite sur la ligne de facture"),
  reference: z
    .string()
    .nullable()
    .describe("La référence/code fournisseur de la ligne si présente et lisible, sinon null"),
  prix: z
    .string()
    .nullable()
    .describe(
      "Le prix de la ligne tel qu'écrit sur le document (chaîne brute), sans conversion ni calcul. " +
        "Null si illisible ou absent sur cette ligne."
    ),
  conditionnement: z
    .string()
    .nullable()
    .describe("Le conditionnement tel qu'écrit s'il est visible sur la ligne, sinon null. Jamais déduit ou inventé."),
});

const ExtractionFactureSchema = z.object({
  numero: z.string().nullable().describe("Le numéro de facture tel qu'écrit sur le document, sinon null"),
  dateDocument: z
    .string()
    .nullable()
    .describe("La date de la facture telle qu'écrite sur le document (chaîne brute, ex. « 15/03/2026 »), sinon null"),
  montantTotal: z
    .number()
    .nullable()
    .describe("Le montant total TTC ou HT de la facture s'il est explicitement indiqué, sinon null"),
  lignes: z.array(LigneFactureSchema),
});

// Extrait les métadonnées et les lignes brutes (niveau A) d'une photo de facture fournisseur. Ne
// devine jamais un numéro, une date, un montant ou une ligne absente ou illisible : utilise null
// plutôt que d'inventer, conformément à la règle déjà suivie par l'extraction de recette et de
// listing.
export async function extraireFacturePhoto(photoDataUrl: string): Promise<FactureExtraite> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ImportIANonConfigureError();
  }

  const { mediaType, data } = parserDataUrlImage(photoDataUrl);
  if (!MEDIA_TYPES_IMAGE_ACCEPTES.includes(mediaType as MediaTypeImage)) {
    throw new PhotoInvalideError("Format de photo non pris en charge (jpeg, png, gif ou webp attendu)");
  }

  const client = new Anthropic();

  const reponse = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 8000,
    output_config: { format: zodOutputFormat(ExtractionFactureSchema), effort: "medium" },
    system:
      "Tu extrais les informations d'une facture fournisseur photographiée, en français. Règle " +
      "absolue : ne jamais inventer une information absente ou illisible (numéro, date, montant, " +
      "désignation, prix, référence, conditionnement) — utilise null plutôt que de deviner. Ne " +
      "calcule et ne convertis jamais un prix ou un montant (pas de division, pas de total " +
      "recalculé) : rapporte chaque valeur exactement telle qu'elle est écrite sur le document, en " +
      "chaîne de caractères brute pour les prix et la date. Ignore les lignes d'en-tête ou de pied " +
      "de page qui ne correspondent à aucun produit précis (mentions légales, coordonnées...).",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as MediaTypeImage, data } },
          { type: "text", text: "Voici une photo d'une facture fournisseur." },
        ],
      },
    ],
  });

  if (!reponse.parsed_output) {
    throw new Error("Impossible d'analyser cette facture");
  }

  return reponse.parsed_output;
}
