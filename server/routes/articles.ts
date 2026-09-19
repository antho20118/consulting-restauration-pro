import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";
import {
  extraireQuantiteDesignation,
  parsePrix,
  SEUIL_CORRESPONDANCE_DESIGNATION,
  trouverCorrespondance,
  type CandidatExistant,
} from "../utils/importListing.js";

const router = Router();

const inclusionsArticle = {
  categorie: true,
  tva: true,
  nutrition: true,
  documents: true,
  allergenes: {
    include: {
      allergene: true,
    },
  },
  tarifs: {
    where: { actif: true },
    orderBy: { dateDebut: "desc" as const },
    take: 1,
    include: {
      fournisseur: true,
      unite: true,
      conditionnement: true,
    },
  },
  stocks: {
    include: {
      depot: true,
    },
  },
};

router.get("/", async (_req: Request, res: Response) => {
  try {
    const articles = await prisma.article.findMany({
      where: { actif: true },
      include: inclusionsArticle,
      orderBy: {
        nom: "asc",
      },
    });

    res.json(articles);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Impossible de récupérer les articles",
    });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      nom,
      reference,
      categorieId,
      tvaId,
      societeId,
      rendement,
      type,
      uniteId,
      fournisseurNom,
      prixHT,
      stockInitial,
      allergeneIds,
    } = req.body;

    const article = await prisma.$transaction(async (tx) => {
      const created = await tx.article.create({
        data: {
          nom,
          reference,
          categorieId,
          tvaId,
          societeId,
          rendement,
          type,
        },
      });

      if (Array.isArray(allergeneIds) && allergeneIds.length > 0) {
        await tx.articleAllergene.createMany({
          data: allergeneIds.map((allergeneId: number) => ({
            articleId: created.id,
            allergeneId,
          })),
        });
      }

      // Tarif (prix + unité + fournisseur) : uniquement si une unité et un prix ont été fournis
      if (uniteId && prixHT !== undefined && prixHT !== null) {
        const fournisseurId = await trouverOuCreerFournisseur(tx, fournisseurNom, societeId);

        // Conditionnement par défaut : le premier existant (non exposé dans ce formulaire simplifié)
        const conditionnement = await tx.conditionnement.findFirst({ orderBy: { id: "asc" } });
        if (conditionnement) {
          await tx.tarifArticle.create({
            data: {
              articleId: created.id,
              fournisseurId,
              uniteId,
              conditionnementId: conditionnement.id,
              quantiteConditionnement: 1,
              prixHT,
            },
          });
        }
      }

      // Stock initial : uniquement si un dépôt existe déjà pour cette société
      if (stockInitial !== undefined && stockInitial !== null) {
        const depot = await tx.depot.findFirst({ where: { societeId } });
        if (depot) {
          await tx.stock.create({
            data: { articleId: created.id, depotId: depot.id, quantite: stockInitial },
          });
        }
      }

      return tx.article.findUnique({
        where: { id: created.id },
        include: inclusionsArticle,
      });
    });

    res.status(201).json(article);
  } catch (error) {
    console.error("========== ERREUR PRISMA ==========");
    console.error(error);
    console.error("===================================");

    res.status(500).json(error);
  }
});

// Modification d'un article : les champs de base sont mis à jour directement ; un changement
// de prix/unité/fournisseur clôt le tarif actif et en ouvre un nouveau (historique des prix) ;
// le stock du dépôt principal est ajusté à la valeur saisie.
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const {
      nom,
      reference,
      categorieId,
      rendement,
      uniteId,
      fournisseurNom,
      prixHT,
      stockInitial,
      allergeneIds,
    } = req.body;

    const article = await prisma.$transaction(async (tx) => {
      const existant = await tx.article.findUniqueOrThrow({ where: { id } });

      await tx.article.update({
        where: { id },
        data: { nom, reference, categorieId, rendement },
      });

      if (Array.isArray(allergeneIds)) {
        await tx.articleAllergene.deleteMany({ where: { articleId: id } });

        if (allergeneIds.length > 0) {
          await tx.articleAllergene.createMany({
            data: allergeneIds.map((allergeneId: number) => ({ articleId: id, allergeneId })),
          });
        }
      }

      if (uniteId && prixHT !== undefined && prixHT !== null) {
        const fournisseurId = await trouverOuCreerFournisseur(tx, fournisseurNom, existant.societeId);

        const tarifActif = await tx.tarifArticle.findFirst({
          where: { articleId: id, actif: true },
          orderBy: { dateDebut: "desc" },
        });

        const inchange =
          tarifActif &&
          tarifActif.uniteId === uniteId &&
          tarifActif.fournisseurId === fournisseurId &&
          tarifActif.prixHT === prixHT;

        if (!inchange) {
          if (tarifActif) {
            await tx.tarifArticle.update({
              where: { id: tarifActif.id },
              data: { actif: false, dateFin: new Date() },
            });
          }

          const conditionnement = await tx.conditionnement.findFirst({ orderBy: { id: "asc" } });
          if (conditionnement) {
            await tx.tarifArticle.create({
              data: {
                articleId: id,
                fournisseurId,
                uniteId,
                conditionnementId: conditionnement.id,
                quantiteConditionnement: 1,
                prixHT,
              },
            });
          }
        }
      }

      if (stockInitial !== undefined && stockInitial !== null) {
        const depot = await tx.depot.findFirst({ where: { societeId: existant.societeId } });
        if (depot) {
          await tx.stock.upsert({
            where: { articleId_depotId: { articleId: id, depotId: depot.id } },
            update: { quantite: stockInitial },
            create: { articleId: id, depotId: depot.id, quantite: stockInitial },
          });
        }
      }

      return tx.article.findUnique({ where: { id }, include: inclusionsArticle });
    });

    res.json(article);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier l'article" });
  }
});

// Suppression (douce) d'un article
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    await prisma.article.update({ where: { id }, data: { actif: false } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer l'article" });
  }
});

// Import d'un listing fournisseur (Excel/CSV, déjà parsé côté frontend) : chaque ligne est
// rapprochée des articles existants (par référence puis par similarité de désignation) ; une
// correspondance met à jour le tarif (historisé) si le prix/l'unité a changé, sinon crée un
// nouvel article avec son premier tarif.
router.post("/import", async (req: Request, res: Response) => {
  try {
    const { societeId, fournisseurNom, categorieId, tvaId, type, lignes } = req.body;

    if (!Array.isArray(lignes) || lignes.length === 0) {
      res.status(400).json({ error: "Aucune ligne à importer" });
      return;
    }

    // Un listing fournisseur peut compter plusieurs milliers de lignes : on évite de tout
    // traiter dans une seule transaction interactive (délai par défaut de 5s chez Prisma, qui
    // se ferme avant la fin d'un import volumineux). Seules les écritures d'une même ligne
    // (clôture + ouverture de tarif, ou création d'article + tarif) sont transactionnelles.
    const fournisseurId = await trouverOuCreerFournisseur(prisma, fournisseurNom, societeId);

    const [
      uniteKg,
      uniteL,
      unitePiece,
      conditionnement,
      allergenesExistants,
      categoriesExistantes,
      articlesExistants,
    ] = await Promise.all([
      prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } }),
      prisma.unite.findFirst({ where: { symbole: { equals: "l", mode: "insensitive" } } }),
      prisma.unite.findFirst({ where: { symbole: { equals: "pièce", mode: "insensitive" } } }),
      prisma.conditionnement.findFirst({ orderBy: { id: "asc" } }),
      prisma.allergene.findMany(),
      prisma.categorie.findMany({ where: { actif: true } }),
      prisma.article.findMany({
        where: { societeId, actif: true },
        select: { id: true, nom: true, reference: true },
      }),
    ]);

    // Un fournisseur mélange souvent plusieurs rayons (épicerie, frais, surgelés…) dans un même
    // listing : la catégorie d'un nouvel article vient en priorité de la colonne mappée dans le
    // fichier (créée à la volée si elle n'existe pas encore), et à défaut de la catégorie par
    // défaut choisie dans la modale d'import.
    const categorieIdParNom = new Map<string, number>();
    for (const c of categoriesExistantes) {
      categorieIdParNom.set(c.nom.trim().toLowerCase(), c.id);
    }

    const candidats: CandidatExistant[] = articlesExistants.map((a) => ({
      articleId: a.id,
      nom: a.nom,
      reference: a.reference,
    }));

    // Tarifs actifs des articles existants, préchargés en une seule requête plutôt qu'une par
    // ligne rapprochée.
    const tarifsActifsExistants = await prisma.tarifArticle.findMany({
      where: { actif: true, articleId: { in: articlesExistants.map((a) => a.id) } },
      orderBy: { dateDebut: "desc" },
    });
    const tarifActifParArticle = new Map<number, (typeof tarifsActifsExistants)[number]>();
    for (const t of tarifsActifsExistants) {
      if (!tarifActifParArticle.has(t.articleId)) tarifActifParArticle.set(t.articleId, t);
    }

    let crees = 0;
    let misesAJour = 0;
    let inchanges = 0;
    const erreurs: string[] = [];

    for (const ligne of lignes) {
      const designation = String(ligne.designation ?? "").trim();
      if (!designation) continue;

      const reference = ligne.reference ? String(ligne.reference).trim() : null;
      const prixTotal = parsePrix(ligne.prix);
      if (prixTotal === null) {
        erreurs.push(`Prix illisible pour "${designation}"`);
        continue;
      }

      // Déduit l'unité de vente (kg/L) et le prix unitaire correspondant à partir de la
      // désignation/du conditionnement ; à défaut, l'article est considéré vendu à la pièce.
      const quantiteDetectee = extraireQuantiteDesignation(designation, ligne.conditionnement);
      let uniteId: number | null = null;
      let prixHT = prixTotal;

      if (quantiteDetectee && quantiteDetectee.quantite > 0) {
        const unite = quantiteDetectee.unite === "kg" ? uniteKg : uniteL;
        if (unite) {
          uniteId = unite.id;
          prixHT = Math.round((prixTotal / quantiteDetectee.quantite) * 10000) / 10000;
        }
      }
      if (uniteId === null && unitePiece) {
        uniteId = unitePiece.id;
      }
      if (uniteId === null) {
        erreurs.push(`Aucune unité disponible pour "${designation}"`);
        continue;
      }
      if (!conditionnement) {
        erreurs.push(`Aucun conditionnement configuré pour "${designation}"`);
        continue;
      }

      const { candidat, score, parReference } = trouverCorrespondance(designation, reference, candidats);
      const correspondanceValide = candidat && (parReference || score >= SEUIL_CORRESPONDANCE_DESIGNATION);

      if (correspondanceValide && candidat) {
        const tarifActif = tarifActifParArticle.get(candidat.articleId);

        const inchange =
          tarifActif &&
          tarifActif.uniteId === uniteId &&
          tarifActif.fournisseurId === fournisseurId &&
          tarifActif.prixHT === prixHT;

        if (inchange) {
          inchanges++;
          continue;
        }

        const operations = [];
        if (tarifActif) {
          operations.push(
            prisma.tarifArticle.update({
              where: { id: tarifActif.id },
              data: { actif: false, dateFin: new Date() },
            })
          );
        }
        operations.push(
          prisma.tarifArticle.create({
            data: {
              articleId: candidat.articleId,
              fournisseurId,
              uniteId,
              conditionnementId: conditionnement.id,
              quantiteConditionnement: 1,
              prixHT,
            },
          })
        );

        const resultats = await prisma.$transaction(operations);
        tarifActifParArticle.set(candidat.articleId, resultats[resultats.length - 1]);

        misesAJour++;
      } else {
        const nomsAllergenes = String(ligne.allergenes ?? "")
          .split(/[,/;]/)
          .map((m) => m.trim().toLowerCase())
          .filter(Boolean);

        const allergeneIds = allergenesExistants
          .filter((a) => nomsAllergenes.includes(a.nom.toLowerCase()))
          .map((a) => a.id);

        const nomCategorie = ligne.categorie ? String(ligne.categorie).trim() : "";
        let categorieIdLigne = categorieId;
        if (nomCategorie) {
          const cleCategorie = nomCategorie.toLowerCase();
          const categorieExistanteId = categorieIdParNom.get(cleCategorie);
          if (categorieExistanteId) {
            categorieIdLigne = categorieExistanteId;
          } else {
            const categorieCreee = await prisma.categorie.upsert({
              where: { nom: nomCategorie },
              update: {},
              create: { nom: nomCategorie },
            });
            categorieIdParNom.set(cleCategorie, categorieCreee.id);
            categorieIdLigne = categorieCreee.id;
          }
        }

        const { nouvelArticle, tarifCree } = await prisma.$transaction(async (tx) => {
          const created = await tx.article.create({
            data: {
              nom: designation,
              reference,
              categorieId: categorieIdLigne,
              tvaId,
              societeId,
              type: type || "MATIERE_PREMIERE",
            },
          });

          if (allergeneIds.length > 0) {
            await tx.articleAllergene.createMany({
              data: allergeneIds.map((allergeneId) => ({ articleId: created.id, allergeneId })),
            });
          }

          const tarifCree = await tx.tarifArticle.create({
            data: {
              articleId: created.id,
              fournisseurId,
              uniteId,
              conditionnementId: conditionnement.id,
              quantiteConditionnement: 1,
              prixHT,
            },
          });

          return { nouvelArticle: created, tarifCree };
        });

        candidats.push({ articleId: nouvelArticle.id, nom: designation, reference });
        tarifActifParArticle.set(nouvelArticle.id, tarifCree);
        crees++;
      }
    }

    res.json({ crees, misesAJour, inchanges, erreurs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible d'importer le listing" });
  }
});

// Rapprochement par code article (référence), pour l'import d'un fichier de coûts de recettes
// (voir ImporterFichierCoutsModal.tsx) : contrairement à l'import de listing fournisseur
// ci-dessus, ici on veut une correspondance exacte, jamais une approximation par nom — c'est
// précisément le point de départ de la demande ("se servir des codes articles"). Une référence
// sans article actif, ou avec un article sans tarif actif (donc sans unité fiable), n'apparaît
// pas dans la réponse : le client la traite comme non trouvée.
router.post("/rechercher-par-reference", async (req: Request, res: Response) => {
  try {
    const { references } = req.body as { references: string[] };

    if (!Array.isArray(references) || references.length === 0) {
      res.json({ trouves: [] });
      return;
    }

    const refsNettoyees = [...new Set(references.map((r) => String(r).trim()).filter(Boolean))];

    const articles = await prisma.article.findMany({
      where: { reference: { in: refsNettoyees }, actif: true },
      include: {
        tarifs: {
          where: { actif: true },
          orderBy: { dateDebut: "desc" },
          take: 1,
        },
      },
    });

    const trouves = articles
      .filter((article) => article.tarifs.length > 0)
      .map((article) => ({
        reference: article.reference as string,
        articleId: article.id,
        nom: article.nom,
        uniteId: article.tarifs[0].uniteId,
        prixHT: article.tarifs[0].prixHT,
      }));

    res.json({ trouves });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de rapprocher les codes articles" });
  }
});

async function trouverOuCreerFournisseur(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  fournisseurNom: string | undefined,
  societeId: number
): Promise<number> {
  const nomFournisseur = (fournisseurNom || "").trim();
  const nomRecherche = nomFournisseur || "Non renseigné";

  const existant = await tx.fournisseur.findFirst({ where: { nom: nomRecherche, societeId } });
  if (existant) return existant.id;

  const cree = await tx.fournisseur.create({ data: { nom: nomRecherche, societeId } });
  return cree.id;
}

export default router;
