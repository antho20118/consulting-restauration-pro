import { Prisma } from "@prisma/client";
import prisma from "../prisma.js";

// Résout (ou crée) le ProduitFournisseur identifiant un couple (fournisseur, code produit) — voir
// cadrage §4/§13 : le code produit fournisseur n'est unique QUE par fournisseur, jamais globalement
// (deux fournisseurs différents peuvent légitimement partager le même code, ce sont alors deux
// ProduitFournisseur distincts). Jamais de code inventé : articleId/designation proviennent toujours
// de la ligne réellement importée. Robuste à la concurrence : une violation de la contrainte unique
// (deux imports concurrents créant le même couple) est traitée comme "déjà créé par l'autre", jamais
// comme une erreur — la ligne relit alors ce que l'autre transaction vient de committer.
//
// Partagé entre l'import Excel historique (server/routes/articles.ts) et l'import photo
// listing/facture (server/routes/listingsFournisseur.ts, server/utils/rapprochementFournisseur.ts) —
// même garantie d'identité stable dans les deux pipelines, jamais deux implémentations séparées.
export async function resoudreOuCreerProduitFournisseur(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  fournisseurId: number,
  codeProduitFournisseur: string,
  articleId: number,
  designation: string
): Promise<{ id: number; designationConnue: string }> {
  const existant = await tx.produitFournisseur.findUnique({
    where: { fournisseurId_codeProduitFournisseur: { fournisseurId, codeProduitFournisseur } },
  });
  if (existant) return existant;

  try {
    return await tx.produitFournisseur.create({
      data: { fournisseurId, codeProduitFournisseur, articleId, designationConnue: designation },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return await tx.produitFournisseur.findUniqueOrThrow({
        where: { fournisseurId_codeProduitFournisseur: { fournisseurId, codeProduitFournisseur } },
      });
    }
    throw error;
  }
}
