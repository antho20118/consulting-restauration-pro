import prisma from "../prisma.js";

export class StockInsuffisantError extends Error {}

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Applique un mouvement de stock (ENTREE/SORTIE) et ajuste Stock en conséquence, dans la même
// transaction que l'appelant — cœur de logique partagé entre POST /mouvements (saisie manuelle,
// voir mouvements.ts) et la réception d'une commande fournisseur (voir commandes.ts) : jamais deux
// implémentations séparées de la règle « le stock ne descend jamais sous zéro ». Ne valide PAS
// l'existence d'articleId/depotId (responsabilité de l'appelant, qui les connaît déjà par
// construction dans le cas d'une commande — voir la FK déjà validée à la création de la ligne).
export async function appliquerMouvementStock(
  tx: TransactionClient,
  params: { articleId: number; depotId: number; type: "ENTREE" | "SORTIE"; quantite: number; motif?: string | null }
): Promise<{ id: number }> {
  const delta = params.type === "ENTREE" ? params.quantite : -params.quantite;

  const stockActuel = await tx.stock.findUnique({
    where: { articleId_depotId: { articleId: params.articleId, depotId: params.depotId } },
  });

  const nouvelleQuantite = (stockActuel?.quantite ?? 0) + delta;
  if (nouvelleQuantite < 0) {
    throw new StockInsuffisantError();
  }

  await tx.stock.upsert({
    where: { articleId_depotId: { articleId: params.articleId, depotId: params.depotId } },
    update: { quantite: nouvelleQuantite },
    create: { articleId: params.articleId, depotId: params.depotId, quantite: nouvelleQuantite },
  });

  return tx.mouvementStock.create({
    data: {
      articleId: params.articleId,
      depotId: params.depotId,
      type: params.type,
      quantite: params.quantite,
      motif: params.motif ?? null,
    },
  });
}
