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
  params: {
    articleId: number;
    depotId: number;
    type: "ENTREE" | "SORTIE";
    quantite: number;
    motif?: string | null;
    // Production ayant consommé cet article (voir POST /productions) — absent pour une saisie
    // manuelle ou une réception de commande, les deux autres appelants de cette fonction.
    productionId?: number | null;
  }
): Promise<{ id: number }> {
  // Mise à jour ATOMIQUE en base, jamais « lire le stock puis réécrire la nouvelle valeur » : deux
  // mouvements simultanés sur le même article/dépôt (deux saisies, une réception pendant une
  // production...) lisaient la même valeur et l'un écrasait l'autre — mise à jour perdue, stock
  // différent de la somme des mouvements (constat de l'audit du 15/10). Ici, Postgres verrouille la
  // ligne et applique les mouvements l'un après l'autre.
  if (params.type === "ENTREE") {
    // INSERT ... ON CONFLICT : crée la ligne de stock à la première entrée, sans risque qu'une
    // seconde entrée simultanée échoue sur la contrainte unique (articleId, depotId).
    await tx.$executeRaw`
      INSERT INTO "Stock" ("articleId", "depotId", "quantite")
      VALUES (${params.articleId}, ${params.depotId}, ${params.quantite})
      ON CONFLICT ("articleId", "depotId") DO UPDATE SET "quantite" = "Stock"."quantite" + EXCLUDED."quantite"
    `;
  } else {
    // Ne décrémente que si le stock suffit, en une seule instruction : le stock ne descend jamais
    // sous zéro, même avec des sorties simultanées.
    const { count } = await tx.stock.updateMany({
      where: { articleId: params.articleId, depotId: params.depotId, quantite: { gte: params.quantite } },
      data: { quantite: { decrement: params.quantite } },
    });
    if (count === 0) {
      throw new StockInsuffisantError();
    }
  }

  return tx.mouvementStock.create({
    data: {
      articleId: params.articleId,
      depotId: params.depotId,
      type: params.type,
      quantite: params.quantite,
      motif: params.motif ?? null,
      productionId: params.productionId ?? null,
    },
  });
}
