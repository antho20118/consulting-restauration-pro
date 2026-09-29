import prisma from "../prisma.js";
import { versUniteBase } from "./uniteConversion.js";

export type BesoinAchat = {
  articleId: number;
  // Quantité exprimée dans l'unité de la recette (pas forcément l'unité base) ; multipliée par
  // facteurUniteRecette (voir Unite.facteurBase) pour la ramener à l'unité base de l'article,
  // seule échelle comparable au stock et au conditionnement fournisseur.
  quantite: number;
  facteurUniteRecette: number;
};

export type LigneAchat =
  | {
      articleId: number;
      article: string;
      besoinBase: number;
      stock: number;
      netBase: number;
      statut: "ARTICLE_INTROUVABLE";
    }
  | {
      articleId: number;
      article: string;
      besoinBase: number;
      stock: number;
      netBase: number;
      statut: "FOURNISSEUR_MANQUANT";
    }
  | {
      articleId: number;
      article: string;
      besoinBase: number;
      stock: number;
      netBase: number;
      fournisseur: string;
      fournisseurId: number;
      conditionnement: string;
      conditionnements: number;
      quantiteCommandeeBase: number;
      prixUnitaireBase: number;
      coutCommandeHT: number;
      statut: "A_COMMANDER" | "STOCK_SUFFISANT";
    };

// Calcule la proposition d'achat à partir d'une liste de besoins (issus par exemple d'une
// planification de production, voir planifierProduction.ts) : regroupe les besoins par article,
// déduit le stock d'un dépôt si fourni, choisit le tarif actif le moins cher une fois ramené à
// l'unité de base (le même principe de normalisation que le coût des recettes, voir
// coutRecette.ts), puis arrondit la quantité à commander au conditionnement supérieur — jamais en
// dessous du besoin réel.
//
// Partagée entre POST /achats/proposition (prévisualisation, lecture seule) et POST /commandes
// (enregistrement réel, voir commandes.ts) : la commande enregistrée doit toujours refléter l'état
// courant du stock/des tarifs au moment de l'écriture, jamais une proposition figée transmise par
// le client (même principe que PR #79 côté import listing) — donc toujours recalculée ici, jamais
// dupliquée.
export async function calculerPropositionAchat(
  besoins: BesoinAchat[],
  depotId?: number
): Promise<{ lignes: LigneAchat[]; totalHT: number }> {
  const articleIds = [...new Set(besoins.map((b) => b.articleId))];

  const [articles, stocks] = await Promise.all([
    prisma.article.findMany({
      where: { id: { in: articleIds }, actif: true },
      include: {
        tarifs: {
          where: { actif: true },
          orderBy: { dateDebut: "desc" },
          include: { fournisseur: true, unite: true, conditionnement: true },
        },
      },
    }),
    depotId
      ? prisma.stock.findMany({ where: { depotId, articleId: { in: articleIds } } })
      : Promise.resolve([]),
  ]);
  const articleParId = new Map(articles.map((a) => [a.id, a]));
  const stockParArticle = new Map(stocks.map((s) => [s.articleId, s.quantite]));

  const besoinBaseParArticle = new Map<number, number>();
  for (const besoin of besoins) {
    const cumul = besoinBaseParArticle.get(besoin.articleId) ?? 0;
    besoinBaseParArticle.set(besoin.articleId, cumul + versUniteBase(besoin.quantite, { facteurBase: besoin.facteurUniteRecette }));
  }

  const lignes: LigneAchat[] = [...besoinBaseParArticle.entries()].map(([articleId, besoinBase]) => {
    const article = articleParId.get(articleId);
    const stock = stockParArticle.get(articleId) ?? 0;
    const netBase = Math.max(0, besoinBase - stock);

    // Besoin sur un article introuvable ou désactivé depuis la planification qui l'a produit :
    // signalé plutôt que silencieusement omis de la proposition.
    if (!article) {
      return { articleId, article: `Article #${articleId}`, besoinBase, stock, netBase, statut: "ARTICLE_INTROUVABLE" };
    }

    const tarifsValides = article.tarifs.filter(
      (t) => t.quantiteConditionnement > 0 && t.unite.facteurBase > 0
    );
    const tarif = tarifsValides.sort(
      (a, b) =>
        a.prixHT / (a.quantiteConditionnement * a.unite.facteurBase) -
        b.prixHT / (b.quantiteConditionnement * b.unite.facteurBase)
    )[0];

    if (!tarif) {
      return { articleId, article: article.nom, besoinBase, stock, netBase, statut: "FOURNISSEUR_MANQUANT" };
    }

    const quantiteParConditionnementBase = tarif.quantiteConditionnement * tarif.unite.facteurBase;
    const conditionnements = Math.ceil(netBase / quantiteParConditionnementBase);
    const prixUnitaireBase = tarif.prixHT / quantiteParConditionnementBase;

    return {
      articleId,
      article: article.nom,
      besoinBase,
      stock,
      netBase,
      fournisseur: tarif.fournisseur.nom,
      fournisseurId: tarif.fournisseur.id,
      conditionnement: tarif.conditionnement.nom,
      conditionnements,
      quantiteCommandeeBase: conditionnements * quantiteParConditionnementBase,
      prixUnitaireBase,
      coutCommandeHT: conditionnements * tarif.prixHT,
      statut: netBase > 0 ? "A_COMMANDER" : "STOCK_SUFFISANT",
    };
  });

  const totalHT = lignes.reduce((total, ligne) => total + ("coutCommandeHT" in ligne ? ligne.coutCommandeHT : 0), 0);

  return { lignes, totalHT };
}
