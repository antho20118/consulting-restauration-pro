// Extraction par vision IA d'un listing fournisseur photographié — même mécanisme que
// server/utils/importRecetteIA.ts (Anthropic, schéma Zod structuré), réutilisé sans modifier ce
// fichier (voir Phase 3 : zéro régression garantie par construction en ne touchant jamais aux
// fichiers déjà éprouvés). Erreurs réutilisées telles quelles (ImportIANonConfigureError,
// PhotoInvalideError) pour que la route mappe les mêmes codes HTTP que /recettes/import-ia.
//
// Ne fait aucun rapprochement avec les articles existants (voir rapprochementFournisseur.ts,
// Phase 3, appelé séparément par la route) : produit uniquement des données niveau A (ce que le
// document dit), jamais une proposition ni une décision.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { ImportIANonConfigureError, PhotoInvalideError } from "./importRecetteIA.js";

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

export type LigneListingExtraite = {
  designation: string;
  reference: string | null;
  // Prix total tel que lu sur le document (avant toute conversion à l'unité) — jamais réinterprété
  // ici : la conversion en prix HT à l'unité réutilise extraireQuantiteDesignation/parsePrix
  // (importListing.ts, Phase 3, inchangé) au moment du rapprochement, pas pendant l'extraction.
  prix: string | null;
  conditionnement: string | null;
};

const LigneListingSchema = z.object({
  designation: z.string().describe("La désignation du produit telle qu'écrite sur le document"),
  reference: z
    .string()
    .nullable()
    .describe("La référence/code fournisseur de la ligne si présente et lisible, sinon null"),
  prix: z
    .string()
    .nullable()
    .describe(
      "Le prix tel qu'écrit sur le document (chaîne brute, ex. « 12,50 » ou « 12.50 »), sans " +
        "conversion ni calcul. Null si illisible ou absent sur cette ligne."
    ),
  conditionnement: z
    .string()
    .nullable()
    .describe(
      "Le conditionnement tel qu'écrit s'il est visible sur la ligne (ex. « 5KG », « carton de 12 », " +
        "« 1L »), sinon null. Jamais déduit ou inventé."
    ),
});

const ExtractionListingSchema = z.object({
  lignes: z.array(LigneListingSchema),
});

// Extrait les lignes brutes (niveau A) d'une photo de listing/tarif fournisseur — un produit par
// ligne. Ne devine jamais une désignation, un prix ou une référence absente ou illisible : utilise
// null plutôt que d'inventer, conformément à la règle déjà suivie par l'extraction de recette.
export async function extraireLignesListingPhoto(photoDataUrl: string): Promise<LigneListingExtraite[]> {
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
    output_config: { format: zodOutputFormat(ExtractionListingSchema), effort: "medium" },
    system:
      "Tu extrais les lignes d'un listing ou d'un tarif fournisseur photographié (une ligne par " +
      "produit), en français. Règle absolue : ne jamais inventer une information absente ou " +
      "illisible (désignation, prix, référence, conditionnement) — utilise null plutôt que de " +
      "deviner. Ne calcule et ne convertis jamais un prix (pas de division par une quantité, pas de " +
      "prix à l'unité) : rapporte le prix exactement tel qu'il est écrit sur le document, en chaîne " +
      "de caractères brute. Ignore les lignes d'en-tête, de total, de sous-total ou de pied de page " +
      "qui ne correspondent à aucun produit précis.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as MediaTypeImage, data } },
          { type: "text", text: "Voici une photo d'un listing/tarif fournisseur." },
        ],
      },
    ],
  });

  if (!reponse.parsed_output) {
    throw new Error("Impossible d'analyser ce listing");
  }

  return reponse.parsed_output.lignes;
}
