import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import prisma from "../prisma.js";
import {
  analyserPropositionLigne,
  parsePrix,
  extraireQuantiteDesignation,
  cleTarifActif,
  SEUIL_CORRESPONDANCE_DESIGNATION,
  similariteJaccard,
  type CandidatExistant,
  type ContexteAnalyseLigne,
  type PropositionLigneImport,
} from "../utils/importListing.js";
import {
  repondreErreurEcriture,
  FournisseurAmbiguError,
  FournisseurInactifError,
  FournisseurCodeInconnuError,
} from "../utils/erreursEcriture.js";

// Ajoutée par le chantier « identité fournisseur + historique des imports » : jamais dans
// importListing.ts (analyserPropositionLigne ne résout et ne crée jamais lui-même un fournisseur,
// voir son propre commentaire) — l'ambiguïté ne peut être détectée qu'à l'endroit où le fournisseur
// est effectivement résolu, donc ici, avant même d'appeler analyserPropositionLigne pour la ligne
// concernée.
type PropositionFournisseurAmbigu = {
  statut: "fournisseur_ambigu";
  designation: string;
  reference: string | null;
  nom: string;
  fournisseurIds: number[];
};

const router = Router();

// Validation minimale de la création/modification manuelle d'un article (voir caractérisation
// dédiée) : seuls les champs dont l'absence de contrôle a un effet réel démontré sont validés ici
// — nom vide/trop long, prix négatif, rendement hors des bornes acceptées par le moteur de coût
// (coutRecette.ts::rendementValide, mêmes bornes ]0, 1000]), type hors de l'enum Prisma. Les autres
// champs (categorieId, tvaId, societeId, uniteId, référence, fournisseur…) restent volontairement
// hors de ce lot, leur absence de contrôle n'ayant pas de conséquence différente de ce qui existe
// déjà ailleurs dans ce routeur (contrainte de clé étrangère Postgres, déjà systématiquement
// respectée). Même style que les schémas déjà en place ailleurs (voir server/routes/mouvements.ts).
const champsArticle = {
  nom: z
    .string()
    .trim()
    .min(1, "La désignation est obligatoire")
    .max(200, "La désignation est trop longue (200 caractères maximum)"),
  type: z.enum([
    "MATIERE_PREMIERE",
    "SOUS_RECETTE",
    "PRODUIT_FINI",
    "EMBALLAGE",
    "CONSOMMABLE",
    "ENTRETIEN",
    "PETIT_MATERIEL",
  ]),
  rendement: z
    .number()
    .finite()
    .gt(0, "Le rendement doit être supérieur à 0")
    .lte(1000, "Le rendement ne peut pas dépasser 1000 %")
    .optional(),
  prixHT: z.number().finite().min(0, "Le prix HT ne peut pas être négatif").optional(),
  stockInitial: z
    .number()
    .finite()
    .min(0, "Le stock initial ne peut pas être négatif")
    .nullable()
    .optional(),
};

// Création : type obligatoire, comme aujourd'hui (toujours fourni par les appelants existants).
const schemaCreationArticle = z.object(champsArticle);

// Modification : type n'a jamais été pris en compte par PUT /:id (jamais dans data ci-dessous) et
// ce correctif ne change pas ce comportement.
const schemaModificationArticle = z.object(champsArticle).omit({ type: true });

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
    const analyse = schemaCreationArticle.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Article invalide", details: analyse.error.flatten() });
      return;
    }
    const { nom, type, rendement, prixHT, stockInitial } = analyse.data;
    const { reference, categorieId, tvaId, societeId, uniteId, fournisseurNom, allergeneIds } =
      req.body;
    const confirmationArticleId = req.body.confirmationArticleId;

    // Une référence déjà utilisée par un autre article actif ne doit jamais créer un doublon
    // silencieusement (voir caractérisation dédiée) : recherche recalculée à CET instant précis
    // (jamais une liste transmise par le client), comparée comme côté client
    // (correspondanceArticle.ts::trouverArticlesCorrespondants : trim + insensible à la casse), pour
    // que la confirmation envoyée par l'utilisateur porte bien sur ce que le serveur détecte
    // réellement. Sans confirmation explicitement liée à l'UN de ces articles précis (jamais un
    // simple booléen), la création est refusée — un ID confirmé qui ne correspond plus à aucun
    // doublon recalculé (article désactivé entretemps, ou référence reprise par un autre article
    // entre la prévisualisation et cet appel) est refusé de la même façon, sans logique dédiée
    // supplémentaire.
    const referenceTrim = typeof reference === "string" ? reference.trim() : "";
    if (referenceTrim) {
      const candidatsMemeReference = await prisma.article.findMany({
        where: { actif: true, reference: { not: null } },
        select: { id: true, nom: true, reference: true },
      });
      const doublons = candidatsMemeReference.filter(
        (a) => a.reference && a.reference.trim().toLowerCase() === referenceTrim.toLowerCase()
      );

      if (doublons.length > 0 && !doublons.some((d) => d.id === confirmationArticleId)) {
        res.status(409).json({
          error: "Un article actif utilise déjà cette référence",
          doublons: doublons.map((d) => ({ id: d.id, nom: d.nom, reference: d.reference })),
        });
        return;
      }
    }

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
        const fournisseurId = await resoudreFournisseurOuLever(tx, fournisseurNom, societeId);

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
    repondreErreurEcriture(error, res, "Impossible de créer l'article");
  }
});

// Modification d'un article : les champs de base sont mis à jour directement ; un changement
// de prix/unité/fournisseur clôt le tarif actif et en ouvre un nouveau (historique des prix) ;
// le stock du dépôt principal est ajusté à la valeur saisie.
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const analyse = schemaModificationArticle.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Article invalide", details: analyse.error.flatten() });
      return;
    }
    const { nom, rendement, prixHT, stockInitial } = analyse.data;
    const { reference, categorieId, uniteId, fournisseurNom, allergeneIds } = req.body;
    const confirmationArticleId = req.body.confirmationArticleId;

    // Même protection contre un doublon de référence que POST /articles (voir plus haut) : une
    // modification de référence ne doit pas non plus pouvoir créer silencieusement un doublon actif.
    // Si la référence saisie est la même que la référence déjà en base pour CET article (aucun
    // changement réel), aucune vérification n'est nécessaire — comme aujourd'hui. L'article modifié
    // est explicitement exclu de la recherche de doublons (id: { not: id }).
    const referenceTrim = typeof reference === "string" ? reference.trim() : "";
    if (referenceTrim) {
      const articleActuel = await prisma.article.findUnique({
        where: { id },
        select: { reference: true },
      });
      const referenceActuelle = articleActuel?.reference ?? null;
      const referenceInchangee =
        referenceActuelle !== null &&
        referenceActuelle.trim().toLowerCase() === referenceTrim.toLowerCase();

      if (!referenceInchangee) {
        const candidatsMemeReference = await prisma.article.findMany({
          where: { actif: true, reference: { not: null }, id: { not: id } },
          select: { id: true, nom: true, reference: true },
        });
        const doublons = candidatsMemeReference.filter(
          (a) => a.reference && a.reference.trim().toLowerCase() === referenceTrim.toLowerCase()
        );

        if (doublons.length > 0 && !doublons.some((d) => d.id === confirmationArticleId)) {
          res.status(409).json({
            error: "Un article actif utilise déjà cette référence",
            doublons: doublons.map((d) => ({ id: d.id, nom: d.nom, reference: d.reference })),
          });
          return;
        }
      }
    }

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
        const fournisseurId = await resoudreFournisseurOuLever(tx, fournisseurNom, existant.societeId);

        // Scopé par (articleId, fournisseurId) — jamais articleId seul (voir cadrage, correction du
        // bug critique : un changement de fournisseur/prix ne doit jamais clôturer le tarif actif
        // d'un AUTRE fournisseur pour ce même article).
        const tarifActif = await tx.tarifArticle.findFirst({
          where: { articleId: id, fournisseurId, actif: true },
          orderBy: { dateDebut: "desc" },
        });

        const inchange = tarifActif && tarifActif.uniteId === uniteId && tarifActif.prixHT === prixHT;

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
    repondreErreurEcriture(error, res, "Impossible de modifier l'article");
  }
});

// Suppression définitive de tous les articles, sauf ceux déjà utilisés dans une recette : les
// effacer casserait cette recette (RecetteLigne.articleId), ce qui n'est jamais l'intention d'une
// remise à zéro du catalogue d'ingrédients. Les tables qui référencent un article sans faire
// obstacle à sa suppression (tarifs, allergènes, nutrition, documents, mouvements de stock,
// stocks, alias d'import) sont vidées avec lui.
router.delete("/", async (_req: Request, res: Response) => {
  try {
    const utilises = await prisma.recetteLigne.findMany({
      select: { articleId: true },
      distinct: ["articleId"],
    });
    const idsProteges = new Set(utilises.map((l) => l.articleId));

    const tous = await prisma.article.findMany({ select: { id: true } });
    const idsASupprimer = tous.map((a) => a.id).filter((id) => !idsProteges.has(id));

    if (idsASupprimer.length > 0) {
      await prisma.$transaction([
        prisma.tarifArticle.deleteMany({ where: { articleId: { in: idsASupprimer } } }),
        prisma.articleAllergene.deleteMany({ where: { articleId: { in: idsASupprimer } } }),
        prisma.valeurNutritionnelle.deleteMany({ where: { articleId: { in: idsASupprimer } } }),
        prisma.document.deleteMany({ where: { articleId: { in: idsASupprimer } } }),
        prisma.mouvementStock.deleteMany({ where: { articleId: { in: idsASupprimer } } }),
        prisma.stock.deleteMany({ where: { articleId: { in: idsASupprimer } } }),
        prisma.aliasIngredientImport.deleteMany({ where: { articleId: { in: idsASupprimer } } }),
        prisma.article.deleteMany({ where: { id: { in: idsASupprimer } } }),
      ]);
    }

    res.json({ supprimes: idsASupprimer.length, proteges: idsProteges.size });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de supprimer les articles" });
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
    // Métadonnées du fichier source (nom/type MIME/taille), transmises par le client depuis le
    // File choisi à l'étape 1 — jamais inventées : voir Phase 6 (historique des imports Excel via
    // DocumentFournisseur, réutilisé tel quel). codeFournisseur : identité par défaut du fichier
    // (colonne optionnelle, voir cadrage « identité fournisseur + produit fournisseur » §6, niveau 1).
    // fournisseurId : fournisseur imposé par le contexte de navigation (fiche fournisseur → onglet
    // Listings → Importer, voir cadrage « déplacement de l'import listing ») — quand fourni, prime
    // strictement sur fournisseurNom/codeFournisseur ci-dessus ET sur toute colonne fournisseur/
    // codeFournisseur d'une ligne individuelle : le contenu du fichier ne peut jamais substituer un
    // autre fournisseur à celui déterminé par le contexte d'où l'import a été lancé.
    const { nomFichierOriginal, typeMime, tailleOctets, codeFournisseur, fournisseurId: fournisseurIdContexte } = req.body as {
      nomFichierOriginal?: string;
      typeMime?: string;
      tailleOctets?: number;
      codeFournisseur?: string;
      fournisseurId?: number;
    };

    if (!Array.isArray(lignes) || lignes.length === 0) {
      res.status(400).json({ error: "Aucune ligne à importer" });
      return;
    }

    // Un listing fournisseur peut compter plusieurs milliers de lignes : on évite de tout
    // traiter dans une seule transaction interactive (délai par défaut de 5s chez Prisma, qui
    // se ferme avant la fin d'un import volumineux). Seules les écritures d'une même ligne
    // (clôture + ouverture de tarif, ou création d'article + tarif) sont transactionnelles.
    let fournisseurIdParDefaut: number;
    if (fournisseurIdContexte !== undefined) {
      if (!Number.isInteger(fournisseurIdContexte) || fournisseurIdContexte <= 0) {
        res.status(400).json({ error: "Identifiant fournisseur invalide" });
        return;
      }
      const fournisseurContexte = await prisma.fournisseur.findUnique({ where: { id: fournisseurIdContexte } });
      if (!fournisseurContexte) {
        res.status(404).json({ error: "Fournisseur introuvable" });
        return;
      }
      if (!fournisseurContexte.actif) {
        res.status(409).json({
          error:
            `Le fournisseur "${fournisseurContexte.nom}" existe mais est actuellement inactif : ` +
            "réactive-le explicitement (fiche fournisseur) avant de réimporter.",
          fournisseurId: fournisseurContexte.id,
        });
        return;
      }
      fournisseurIdParDefaut = fournisseurContexte.id;
    } else {
      const resolutionParDefaut = await trouverOuCreerFournisseur(prisma, fournisseurNom, societeId, codeFournisseur);
      if (resolutionParDefaut.statut === "ambigu") {
        res.status(409).json({
          error:
            `Plusieurs fournisseurs existants correspondent au nom "${resolutionParDefaut.nom}" : ` +
            "impossible de déterminer lequel utiliser par défaut sans choix arbitraire. " +
            "Résous cette ambiguïté (fiches fournisseurs) avant de réimporter.",
          fournisseurIds: resolutionParDefaut.fournisseurIds,
        });
        return;
      }
      if (resolutionParDefaut.statut === "inactif") {
        res.status(409).json({
          error:
            `Le fournisseur "${resolutionParDefaut.identifiant}" existe mais est actuellement inactif : ` +
            "réactive-le explicitement (fiche fournisseur) avant de réimporter, ou choisis un autre fournisseur.",
          fournisseurId: resolutionParDefaut.fournisseurId,
        });
        return;
      }
      if (resolutionParDefaut.statut === "code_inconnu") {
        res.status(409).json({
          error: `Aucun fournisseur ne correspond au code "${resolutionParDefaut.code}" : aucune création silencieuse à partir d'un code inconnu.`,
          code: resolutionParDefaut.code,
        });
        return;
      }
      fournisseurIdParDefaut = resolutionParDefaut.fournisseurId;
    }
    // Un fichier combinant plusieurs fournisseurs (une colonne "Fournisseur" par ligne) prime sur
    // le fournisseur unique choisi dans la modale d'import ; mis en cache pour ne résoudre chaque
    // nom qu'une fois même s'il revient sur des centaines de lignes (résolution complète, jamais
    // seulement l'id, pour pouvoir refuser une ligne dont le fournisseur est ambigu sans avoir à
    // interroger la base une deuxième fois).
    const resolutionParNom = new Map<string, ResolutionFournisseur>();
    // Un DocumentFournisseur (type LISTING) par fournisseur physique réellement concerné par CET
    // import — jamais un seul document arbitrairement rattaché au fournisseur par défaut : un
    // fichier mélangeant plusieurs fournisseurs (colonne "Fournisseur" par ligne) doit voir chacun
    // d'eux recevoir son propre historique d'import, jamais mélangé avec celui d'un autre.
    const documentIdParFournisseur = new Map<number, number>();

    async function documentPourFournisseur(fournisseurId: number): Promise<number> {
      const existant = documentIdParFournisseur.get(fournisseurId);
      if (existant) return existant;
      const document = await prisma.documentFournisseur.create({
        data: {
          fournisseurId,
          type: "LISTING",
          // Écriture immédiate (pas d'étape de validation séparée comme pour le listing photo) :
          // le document reflète directement l'état final, jamais "en attente" d'une décision qui
          // a déjà été prise par l'utilisateur en prévisualisation.
          statut: "VALIDE",
          cle: `excel-${randomUUID()}`,
          typeMime: typeMime || "application/octet-stream",
          tailleOctets: typeof tailleOctets === "number" ? tailleOctets : 0,
          nomFichierOriginal: nomFichierOriginal || null,
        },
      });
      documentIdParFournisseur.set(fournisseurId, document.id);
      return document.id;
    }

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
    // ligne rapprochée — indexés par (articleId, fournisseurId), jamais par articleId seul (voir
    // cadrage, correction du bug critique : le tarif actif d'un AUTRE fournisseur ne doit jamais
    // pouvoir être trouvé, donc jamais clôturé, par la ligne d'un fournisseur différent).
    const tarifsActifsExistants = await prisma.tarifArticle.findMany({
      where: { actif: true, articleId: { in: articlesExistants.map((a) => a.id) } },
      orderBy: { dateDebut: "desc" },
    });
    const tarifActifParArticleFournisseur = new Map<string, (typeof tarifsActifsExistants)[number]>();
    for (const t of tarifsActifsExistants) {
      const cle = cleTarifActif(t.articleId, t.fournisseurId);
      if (!tarifActifParArticleFournisseur.has(cle)) tarifActifParArticleFournisseur.set(cle, t);
    }

    const uniteSymboleParId = new Map<number, string>();
    if (uniteKg) uniteSymboleParId.set(uniteKg.id, uniteKg.symbole);
    if (uniteL) uniteSymboleParId.set(uniteL.id, uniteL.symbole);
    if (unitePiece) uniteSymboleParId.set(unitePiece.id, unitePiece.symbole);

    // Contexte transmis à analyserPropositionLigne (voir importListing.ts) : candidats et
    // tarifActifParArticleFournisseur sont les MÊMES objets que ceux mutés plus bas (push/set) à
    // chaque création ou remplacement de tarif, pour qu'une ligne puisse se rapprocher d'un article
    // créé plus tôt dans le même import, exactement comme avant ce correctif.
    const contexteLigne: ContexteAnalyseLigne = {
      candidats,
      tarifActifParArticleFournisseur,
      uniteKgId: uniteKg?.id ?? null,
      uniteLId: uniteL?.id ?? null,
      unitePieceId: unitePiece?.id ?? null,
      uniteSymboleParId,
    };

    let crees = 0;
    let misesAJour = 0;
    let inchanges = 0;
    // Ligne dont la correspondance approximative n'a pas (ou plus) été confirmée explicitement
    // par l'utilisateur : jamais écrite (voir PR #79), à distinguer de misesAJour/erreurs.
    let enAttente = 0;
    const erreurs: string[] = [];

    for (const ligne of lignes) {
      const designation = String(ligne.designation ?? "").trim();
      if (!designation) continue;

      const nomFournisseurLigne = ligne.fournisseur ? String(ligne.fournisseur).trim() : "";
      const codeFournisseurLigne = ligne.codeFournisseur ? String(ligne.codeFournisseur).trim() : "";
      let fournisseurId = fournisseurIdParDefaut;
      // Fournisseur imposé par le contexte (fiche fournisseur) : toute colonne fournisseur/
      // codeFournisseur d'une ligne individuelle est ignorée pour la résolution — jamais de
      // substitution, voir cadrage §10. Sans contexte (import générique depuis Ingrédients),
      // comportement historique inchangé : une ligne peut désigner un autre fournisseur que celui
      // choisi par défaut dans la modale (fichier multi-fournisseurs).
      if (fournisseurIdContexte === undefined && (codeFournisseurLigne || nomFournisseurLigne)) {
        // Le code prime toujours sur le nom pour CETTE ligne (voir cadrage §6, niveau 1) — la clé de
        // cache distingue les deux espaces pour ne jamais confondre un code et un nom qui se
        // ressembleraient par coïncidence.
        const cle = codeFournisseurLigne ? `code:${codeFournisseurLigne}` : `nom:${normaliserIdentiteFournisseur(nomFournisseurLigne)}`;
        let resolution = resolutionParNom.get(cle);
        if (!resolution) {
          resolution = await trouverOuCreerFournisseur(prisma, nomFournisseurLigne, societeId, codeFournisseurLigne);
          resolutionParNom.set(cle, resolution);
        }
        // Ambiguïté/inactivité/code inconnu propres à CETTE ligne : jamais de choix arbitraire, jamais
        // de réutilisation ou de création silencieuse — la ligne est refusée, les autres lignes
        // valides du même import continuent d'être traitées normalement.
        if (resolution.statut === "ambigu") {
          erreurs.push(
            `Plusieurs fournisseurs existants correspondent au nom "${resolution.nom}" pour la ligne ` +
            `"${designation}" : ligne ignorée, ambiguïté à résoudre manuellement.`
          );
          continue;
        }
        if (resolution.statut === "inactif") {
          erreurs.push(
            `Le fournisseur "${resolution.identifiant}" existe mais est inactif pour la ligne ` +
            `"${designation}" : ligne ignorée, réactivation explicite requise.`
          );
          continue;
        }
        if (resolution.statut === "code_inconnu") {
          erreurs.push(
            `Aucun fournisseur ne correspond au code "${resolution.code}" pour la ligne "${designation}" : ` +
            "ligne ignorée, aucune création silencieuse à partir d'un code."
          );
          continue;
        }
        fournisseurId = resolution.fournisseurId;
      }

      // Historique de CET import (Phase 6, réutilise DocumentFournisseur/LigneDocumentFournisseur
      // tels quels — un document par fournisseur physique réellement concerné, jamais un seul
      // document arbitrairement rattaché au fournisseur par défaut d'un fichier qui en mélange
      // plusieurs).
      const documentId = await documentPourFournisseur(fournisseurId);
      const referenceLigne = ligne.reference ? String(ligne.reference).trim() || null : null;
      const prixLu = parsePrix(ligne.prix);
      const codeProduitLigne = ligne.codeProduitFournisseur ? String(ligne.codeProduitFournisseur).trim() : "";

      // --- Niveau 4/7 (cadrage §6/§7) : code produit fournisseur DÉJÀ CONNU chez ce fournisseur —
      // identité certaine par construction, jamais réévaluée par référence/désignation catalogue
      // (contrairement au chemin sans code ci-dessous). Une désignation très différente de celle
      // déjà connue pour ce code déclenche une alerte explicite, jamais un écrasement silencieux. ---
      const produitExistant = codeProduitLigne
        ? await prisma.produitFournisseur.findUnique({
            where: { fournisseurId_codeProduitFournisseur: { fournisseurId, codeProduitFournisseur: codeProduitLigne } },
          })
        : null;

      if (produitExistant) {
        const similarite = similariteJaccard(designation, produitExistant.designationConnue);
        if (similarite < SEUIL_CORRESPONDANCE_DESIGNATION) {
          erreurs.push(
            `Code produit "${codeProduitLigne}" déjà connu chez ce fournisseur avec une désignation très ` +
            `différente ("${produitExistant.designationConnue}" vs "${designation}") : ligne ignorée, décision humaine requise.`
          );
          await prisma.ligneDocumentFournisseur.create({
            data: { documentId, designationLue: designation, referenceLue: referenceLigne, prixLu, decision: "EN_ATTENTE" },
          });
          enAttente++;
          continue;
        }

        if (prixLu === null) {
          erreurs.push(`Prix illisible pour "${designation}"`);
          continue;
        }
        if (!conditionnement) {
          erreurs.push(`Aucun conditionnement configuré pour "${designation}"`);
          continue;
        }

        const quantiteDetecteeCode = extraireQuantiteDesignation(designation, ligne.conditionnement);
        let uniteIdCode: number | null = null;
        let prixHTCode = prixLu;
        if (quantiteDetecteeCode && quantiteDetecteeCode.quantite > 0) {
          const uniteChoisie = quantiteDetecteeCode.unite === "kg" ? (uniteKg?.id ?? null) : (uniteL?.id ?? null);
          if (uniteChoisie) {
            uniteIdCode = uniteChoisie;
            prixHTCode = Math.round((prixLu / quantiteDetecteeCode.quantite) * 10000) / 10000;
          }
        }
        if (uniteIdCode === null && unitePiece) uniteIdCode = unitePiece.id;
        if (uniteIdCode === null) {
          erreurs.push(`Aucune unité disponible pour "${designation}"`);
          continue;
        }

        const cleTarifCode = cleTarifActif(produitExistant.articleId, fournisseurId);
        const tarifActifCode = tarifActifParArticleFournisseur.get(cleTarifCode) ?? null;
        const inchangeCode = tarifActifCode !== null && tarifActifCode.uniteId === uniteIdCode && tarifActifCode.prixHT === prixHTCode;

        if (inchangeCode) {
          inchanges++;
          await prisma.ligneDocumentFournisseur.create({
            data: {
              documentId, designationLue: designation, referenceLue: referenceLigne, prixLu,
              decision: "VALIDEE", articleRetenuId: produitExistant.articleId,
            },
          });
          continue;
        }

        const operationsCode = [];
        if (tarifActifCode) {
          operationsCode.push(
            prisma.tarifArticle.update({ where: { id: tarifActifCode.id }, data: { actif: false, dateFin: new Date() } })
          );
        }
        operationsCode.push(
          prisma.tarifArticle.create({
            data: {
              articleId: produitExistant.articleId,
              fournisseurId,
              uniteId: uniteIdCode,
              conditionnementId: conditionnement.id,
              quantiteConditionnement: 1,
              prixHT: prixHTCode,
              produitFournisseurId: produitExistant.id,
            },
          })
        );
        const resultatsCode = await prisma.$transaction(operationsCode);
        const tarifCreeParCode = resultatsCode[resultatsCode.length - 1];
        tarifActifParArticleFournisseur.set(cleTarifCode, tarifCreeParCode);

        await prisma.ligneDocumentFournisseur.create({
          data: {
            documentId, designationLue: designation, referenceLue: referenceLigne, prixLu,
            decision: "VALIDEE", articleRetenuId: produitExistant.articleId, tarifCreeId: tarifCreeParCode.id,
          },
        });
        misesAJour++;
        continue;
      }

      // --- Chemin sans code déjà connu (niveau 5/6 du cadrage : code absent, ou code inédit chez ce
      // fournisseur) — rapprochement historique inchangé (référence catalogue puis désignation). ---
      // Réévalue la proposition à l'instant de l'écriture, à partir de l'état courant de
      // candidats/tarifActifParArticleFournisseur (jamais une proposition transmise par le client) :
      // c'est cette réévaluation fraîche qui permet de vérifier qu'une confirmation d'approximation
      // porte bien sur la correspondance qui sera réellement écrite (voir PHASE 3, PR #79).
      const proposition = analyserPropositionLigne(
        ligne,
        contexteLigne,
        { fournisseurId, fournisseurNom: nomFournisseurLigne || fournisseurNom }
      );

      if (proposition.statut === "invalide") {
        erreurs.push(`${proposition.motif} pour "${designation}"`);
        await prisma.ligneDocumentFournisseur.create({
          data: { documentId, designationLue: designation, referenceLue: referenceLigne, prixLu, decision: "REJETEE" },
        });
        continue;
      }
      if (!conditionnement) {
        erreurs.push(`Aucun conditionnement configuré pour "${designation}"`);
        continue;
      }

      if (proposition.statut === "tarif_inchange") {
        inchanges++;
        // Un code produit inédit chez ce fournisseur, même sur un tarif inchangé, établit quand même
        // l'identité pour les imports futurs — jamais recréé à chaque changement de prix (voir §7).
        if (codeProduitLigne) {
          await resoudreOuCreerProduitFournisseur(prisma, fournisseurId, codeProduitLigne, proposition.articleId, designation);
        }
        await prisma.ligneDocumentFournisseur.create({
          data: {
            documentId,
            designationLue: designation,
            referenceLue: referenceLigne,
            prixLu,
            decision: "VALIDEE",
            articleRetenuId: proposition.articleId,
          },
        });
        continue;
      }

      if (proposition.statut === "tarif_a_remplacer") {
        if (proposition.typeCorrespondance === "approximative") {
          // Une correspondance approximative ne peut jamais être écrite sans une confirmation
          // explicitement liée à CET article précis — jamais un simple booléen global. Si la
          // proposition a changé entre la prévisualisation et cet appel (état de la base modifié
          // entretemps), la confirmation transmise ne correspond plus à l'article réévalué et
          // l'écriture est refusée.
          if (ligne.confirmationArticleId !== proposition.articleId) {
            enAttente++;
            await prisma.ligneDocumentFournisseur.create({
              data: {
                documentId,
                designationLue: designation,
                referenceLue: referenceLigne,
                prixLu,
                articleProposeId: proposition.articleId,
                confiance: proposition.score,
              },
            });
            continue;
          }
        }

        let produitFournisseurIdAStamper: number | null = null;
        if (codeProduitLigne) {
          const produitCree = await resoudreOuCreerProduitFournisseur(
            prisma, fournisseurId, codeProduitLigne, proposition.articleId, designation
          );
          produitFournisseurIdAStamper = produitCree.id;
        }

        const cle = cleTarifActif(proposition.articleId, fournisseurId);
        const tarifActif = tarifActifParArticleFournisseur.get(cle);

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
              articleId: proposition.articleId,
              fournisseurId,
              uniteId: proposition.uniteId,
              conditionnementId: conditionnement.id,
              quantiteConditionnement: 1,
              prixHT: proposition.nouveauPrixHT,
              produitFournisseurId: produitFournisseurIdAStamper,
            },
          })
        );

        const resultats = await prisma.$transaction(operations);
        const tarifCreeParRemplacement = resultats[resultats.length - 1];
        tarifActifParArticleFournisseur.set(cle, tarifCreeParRemplacement);

        await prisma.ligneDocumentFournisseur.create({
          data: {
            documentId,
            designationLue: designation,
            referenceLue: referenceLigne,
            prixLu,
            decision: "VALIDEE",
            articleRetenuId: proposition.articleId,
            tarifCreeId: tarifCreeParRemplacement.id,
          },
        });

        misesAJour++;
        continue;
      }

      // proposition.statut === "creation" : aucune correspondance valide, comportement inchangé.
      const reference = proposition.reference;
      const uniteId = proposition.uniteId;
      const prixHT = proposition.prixHT;

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

        let produitFournisseurIdAStamper: number | null = null;
        if (codeProduitLigne) {
          const produitCree = await resoudreOuCreerProduitFournisseur(
            tx, fournisseurId, codeProduitLigne, created.id, designation
          );
          produitFournisseurIdAStamper = produitCree.id;
        }

        const tarifCree = await tx.tarifArticle.create({
          data: {
            articleId: created.id,
            fournisseurId,
            uniteId,
            conditionnementId: conditionnement.id,
            quantiteConditionnement: 1,
            prixHT,
            produitFournisseurId: produitFournisseurIdAStamper,
          },
        });

        return { nouvelArticle: created, tarifCree };
      });

      await prisma.ligneDocumentFournisseur.create({
        data: {
          documentId,
          designationLue: designation,
          referenceLue: referenceLigne,
          prixLu,
          decision: "VALIDEE",
          articleRetenuId: nouvelArticle.id,
          tarifCreeId: tarifCree.id,
        },
      });

      candidats.push({ articleId: nouvelArticle.id, nom: designation, reference });
      tarifActifParArticleFournisseur.set(cleTarifActif(nouvelArticle.id, fournisseurId), tarifCree);
      crees++;
    }

    res.json({ crees, misesAJour, inchanges, enAttente, erreurs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible d'importer le listing" });
  }
});

// Prévisualisation en lecture seule d'un import de listing fournisseur (voir PR #79) : produit,
// pour chaque ligne, la MÊME proposition que POST /import écrira réellement (analyserPropositionLigne,
// importListing.ts), sans jamais créer ni modifier le moindre fournisseur, article ou tarif. Le
// client affiche cette prévisualisation et ne peut confirmer une correspondance approximative que
// ligne par ligne (articleId précis), jamais globalement — voir PHASE 3/4 de PR #79.
router.post("/import/apercu", async (req: Request, res: Response) => {
  try {
    const { societeId, fournisseurNom, lignes } = req.body;
    const { fournisseurId: fournisseurIdContexte } = req.body as { fournisseurId?: number };

    if (!Array.isArray(lignes) || lignes.length === 0) {
      res.status(400).json({ error: "Aucune ligne à analyser" });
      return;
    }

    // Même garantie qu'à l'écriture réelle (POST /import) : un fournisseur imposé par le contexte
    // de navigation est vérifié une seule fois pour tout l'aperçu, jamais réévalué ligne par ligne
    // à partir du fichier (voir cadrage §10).
    let fournisseurIdContexteValide: number | null = null;
    let nomFournisseurContexte = "";
    if (fournisseurIdContexte !== undefined) {
      if (!Number.isInteger(fournisseurIdContexte) || fournisseurIdContexte <= 0) {
        res.status(400).json({ error: "Identifiant fournisseur invalide" });
        return;
      }
      const fournisseurContexte = await prisma.fournisseur.findUnique({ where: { id: fournisseurIdContexte } });
      if (!fournisseurContexte) {
        res.status(404).json({ error: "Fournisseur introuvable" });
        return;
      }
      if (!fournisseurContexte.actif) {
        res.status(409).json({
          error:
            `Le fournisseur "${fournisseurContexte.nom}" existe mais est actuellement inactif : ` +
            "réactive-le explicitement (fiche fournisseur) avant de réimporter.",
          fournisseurId: fournisseurContexte.id,
        });
        return;
      }
      fournisseurIdContexteValide = fournisseurContexte.id;
      // Le nom réellement affiché en proposition vient toujours du fournisseur résolu en base,
      // jamais d'un fournisseurNom éventuellement transmis par le client (qui n'a plus de raison
      // d'être envoyé une fois le fournisseur imposé par le contexte).
      nomFournisseurContexte = fournisseurContexte.nom;
    }

    const [
      uniteKg,
      uniteL,
      unitePiece,
      articlesExistants,
      fournisseursExistants,
    ] = await Promise.all([
      prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } }),
      prisma.unite.findFirst({ where: { symbole: { equals: "l", mode: "insensitive" } } }),
      prisma.unite.findFirst({ where: { symbole: { equals: "pièce", mode: "insensitive" } } }),
      prisma.article.findMany({
        where: { societeId, actif: true },
        select: { id: true, nom: true, reference: true },
      }),
      // Lecture seule : un fournisseur absent n'est jamais créé ici, contrairement à
      // POST /import — la prévisualisation ne doit jamais avoir d'effet de bord en base.
      prisma.fournisseur.findMany({ where: { societeId }, select: { id: true, nom: true, actif: true } }),
    ]);

    const candidats: CandidatExistant[] = articlesExistants.map((a) => ({
      articleId: a.id,
      nom: a.nom,
      reference: a.reference,
    }));

    const tarifsActifsExistants = await prisma.tarifArticle.findMany({
      where: { actif: true, articleId: { in: articlesExistants.map((a) => a.id) } },
      orderBy: { dateDebut: "desc" },
    });
    const tarifActifParArticleFournisseur = new Map<string, (typeof tarifsActifsExistants)[number]>();
    for (const t of tarifsActifsExistants) {
      const cle = cleTarifActif(t.articleId, t.fournisseurId);
      if (!tarifActifParArticleFournisseur.has(cle)) tarifActifParArticleFournisseur.set(cle, t);
    }

    // Groupé par identité normalisée (jamais un simple id) : permet de détecter dès l'aperçu
    // qu'un nom correspond à PLUSIEURS fournisseurs existants distincts, exactement comme le fera
    // l'écriture réelle (trouverOuCreerFournisseur, même fonction normaliserIdentiteFournisseur) —
    // aucune divergence possible entre les deux. actif conservé pour détecter dès l'aperçu un
    // fournisseur inactif, exactement comme le fera l'écriture réelle.
    const fournisseursParId = new Map(fournisseursExistants.map((f) => [f.id, f]));
    const fournisseurIdsParIdentite = new Map<string, number[]>();
    for (const f of fournisseursExistants) {
      const cle = normaliserIdentiteFournisseur(f.nom);
      const liste = fournisseurIdsParIdentite.get(cle);
      if (liste) liste.push(f.id);
      else fournisseurIdsParIdentite.set(cle, [f.id]);
    }

    const uniteSymboleParId = new Map<number, string>();
    if (uniteKg) uniteSymboleParId.set(uniteKg.id, uniteKg.symbole);
    if (uniteL) uniteSymboleParId.set(uniteL.id, uniteL.symbole);
    if (unitePiece) uniteSymboleParId.set(unitePiece.id, unitePiece.symbole);

    const contexteLigne: ContexteAnalyseLigne = {
      candidats,
      tarifActifParArticleFournisseur,
      uniteKgId: uniteKg?.id ?? null,
      uniteLId: uniteL?.id ?? null,
      unitePieceId: unitePiece?.id ?? null,
      uniteSymboleParId,
    };

    // Une ligne conserve son index d'origine (jamais filtrée ni réordonnée) : le client doit
    // pouvoir associer chaque proposition à la ligne source du fichier importé, y compris les
    // lignes invalides.
    const propositions: (
      | PropositionLigneImport
      | PropositionFournisseurAmbigu
      | { statut: "fournisseur_inactif"; designation: string; reference: string | null; identifiant: string; fournisseurId: number }
      | { statut: "code_produit_designation_differente"; designation: string; reference: string | null; codeProduitFournisseur: string; designationConnue: string }
    )[] = [];

    for (const ligne of lignes) {
      const designationLigne = String(ligne?.designation ?? "").trim();
      const referenceLigne = ligne?.reference ? String(ligne.reference).trim() : null;

      let fournisseurId: number | null;
      let nomFournisseurResolu: string;

      if (fournisseurIdContexteValide !== null) {
        // Fournisseur imposé par le contexte (fiche fournisseur) : jamais réévalué à partir d'une
        // colonne fournisseur/codeFournisseur de la ligne — voir cadrage §10, même principe qu'à
        // l'écriture réelle (POST /import).
        fournisseurId = fournisseurIdContexteValide;
        nomFournisseurResolu = nomFournisseurContexte;
      } else {
        const nomFournisseurLigne = ligne?.fournisseur ? String(ligne.fournisseur).trim() : "";
        nomFournisseurResolu = nomFournisseurLigne || String(fournisseurNom ?? "").trim();
        const cle = normaliserIdentiteFournisseur(nomFournisseurResolu);
        const correspondances = fournisseurIdsParIdentite.get(cle) ?? [];

        // Plusieurs fournisseurs existants partagent ce nom (après normalisation) : jamais de choix
        // arbitraire, même en aperçu — signalé explicitement plutôt que résolu au hasard.
        if (correspondances.length > 1) {
          propositions.push({
            statut: "fournisseur_ambigu",
            designation: designationLigne,
            reference: referenceLigne,
            nom: nomFournisseurResolu,
            fournisseurIds: correspondances,
          });
          continue;
        }

        fournisseurId = correspondances[0] ?? null;
        const fournisseurTrouve = fournisseurId !== null ? fournisseursParId.get(fournisseurId) : undefined;
        if (fournisseurTrouve && !fournisseurTrouve.actif) {
          propositions.push({
            statut: "fournisseur_inactif",
            designation: designationLigne,
            reference: referenceLigne,
            identifiant: nomFournisseurResolu,
            fournisseurId: fournisseurTrouve.id,
          });
          continue;
        }
      }

      const codeProduitLigne = ligne?.codeProduitFournisseur ? String(ligne.codeProduitFournisseur).trim() : "";
      if (codeProduitLigne && fournisseurId !== null) {
        const produitExistant = await prisma.produitFournisseur.findUnique({
          where: { fournisseurId_codeProduitFournisseur: { fournisseurId, codeProduitFournisseur: codeProduitLigne } },
        });
        if (produitExistant && similariteJaccard(designationLigne, produitExistant.designationConnue) < SEUIL_CORRESPONDANCE_DESIGNATION) {
          propositions.push({
            statut: "code_produit_designation_differente",
            designation: designationLigne,
            reference: referenceLigne,
            codeProduitFournisseur: codeProduitLigne,
            designationConnue: produitExistant.designationConnue,
          });
          continue;
        }
      }

      propositions.push(
        analyserPropositionLigne(ligne, contexteLigne, {
          fournisseurId,
          fournisseurNom: nomFournisseurResolu,
        })
      );
    }

    res.json({ propositions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible d'analyser le listing" });
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

// Règle d'identité fournisseur (chantier « identité fournisseur + historique des imports ») :
// trim + minuscule, rien d'autre — jamais un retrait d'accent ni une compaction des espaces
// internes, jamais appliquée à la valeur stockée (seulement à la comparaison). Utilisée à la fois
// par l'aperçu et par l'écriture réelle pour qu'aucune divergence ne puisse plus exister entre les
// deux (l'aperçu comparait déjà en minuscule, l'écriture comparait en respectant la casse — c'est
// cette divergence précise qui permettait de créer un doublon silencieux à l'écriture après une
// prévisualisation qui reconnaissait pourtant le fournisseur existant).
export function normaliserIdentiteFournisseur(nom: string): string {
  return nom.trim().toLowerCase();
}

export type ResolutionFournisseur =
  | { statut: "ok"; fournisseurId: number }
  // Plusieurs fournisseurs existants partagent la même identité normalisée : jamais de choix
  // arbitraire (premier, plus ancien, plus de tarifs...) — l'appelant doit refuser l'écriture et
  // exposer l'ambiguïté explicitement, tant qu'un humain n'a pas tranché lequel réutiliser.
  | { statut: "ambigu"; nom: string; fournisseurIds: number[] }
  // Le fournisseur retrouvé (par code ou par nom) est actif:false — jamais réutilisé silencieusement,
  // jamais réactivé automatiquement (voir cadrage §8/§9 : POST /fournisseurs/:id/reactiver est une
  // action humaine distincte).
  | { statut: "inactif"; identifiant: string; fournisseurId: number }
  // codeFournisseur fourni mais aucun fournisseur ne correspond : jamais de création silencieuse à
  // partir d'un code (voir cadrage §6, niveau 3) — contrairement à la résolution par nom.
  | { statut: "code_inconnu"; code: string };

// Résout un fournisseur en priorité par codeFournisseur si fourni (recherche stricte, jamais de
// création, jamais de repli sur le nom — voir cadrage §6, niveau 1-3 : « aucune recherche globale
// ... ne doit passer devant cette identité »), sinon par nom normalisé (chemin historique, inchangé
// dans son principe sauf l'ajout du blocage sur fournisseur inactif ci-dessous).
async function trouverOuCreerFournisseur(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  fournisseurNom: string | undefined,
  societeId: number,
  codeFournisseur?: string | null
): Promise<ResolutionFournisseur> {
  const code = (codeFournisseur ?? "").trim();
  if (code) {
    const trouve = await tx.fournisseur.findUnique({
      where: { societeId_codeFournisseur: { societeId, codeFournisseur: code } },
    });
    if (!trouve) {
      return { statut: "code_inconnu", code };
    }
    if (!trouve.actif) {
      return { statut: "inactif", identifiant: code, fournisseurId: trouve.id };
    }
    return { statut: "ok", fournisseurId: trouve.id };
  }

  const nomFournisseur = (fournisseurNom || "").trim();
  const nomRecherche = nomFournisseur || "Non renseigné";
  const cleNormalisee = normaliserIdentiteFournisseur(nomRecherche);

  // Comparaison en mémoire (jamais une contrainte DB pour l'instant, voir cadrage §9/§12) : évite
  // toute dépendance à la collation Postgres et garantit une normalisation strictement identique à
  // celle de l'aperçu (même fonction JS des deux côtés).
  const candidats = await tx.fournisseur.findMany({ where: { societeId }, select: { id: true, nom: true, actif: true } });
  const correspondances = candidats.filter((f) => normaliserIdentiteFournisseur(f.nom) === cleNormalisee);

  if (correspondances.length === 1) {
    const trouve = correspondances[0];
    if (!trouve.actif) {
      return { statut: "inactif", identifiant: nomRecherche, fournisseurId: trouve.id };
    }
    return { statut: "ok", fournisseurId: trouve.id };
  }
  if (correspondances.length > 1) {
    return { statut: "ambigu", nom: nomRecherche, fournisseurIds: correspondances.map((f) => f.id) };
  }

  const cree = await tx.fournisseur.create({ data: { nom: nomRecherche, societeId } });
  return { statut: "ok", fournisseurId: cree.id };
}

// Utilisée par la création/modification manuelle d'un article (un seul fournisseur en jeu, jamais
// de traitement ligne par ligne à poursuivre) : une ambiguïté/inactivité/code inconnu interrompt
// directement l'écriture en cours (transaction annulée), traduite en réponse HTTP explicite par
// repondreErreurEcriture.
async function resoudreFournisseurOuLever(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  fournisseurNom: string | undefined,
  societeId: number,
  codeFournisseur?: string | null
): Promise<number> {
  const resolution = await trouverOuCreerFournisseur(tx, fournisseurNom, societeId, codeFournisseur);
  if (resolution.statut === "ambigu") {
    throw new FournisseurAmbiguError(resolution.nom, resolution.fournisseurIds);
  }
  if (resolution.statut === "inactif") {
    throw new FournisseurInactifError(resolution.identifiant, resolution.fournisseurId);
  }
  if (resolution.statut === "code_inconnu") {
    throw new FournisseurCodeInconnuError(resolution.code);
  }
  return resolution.fournisseurId;
}

// Résout (ou crée) le ProduitFournisseur identifiant un couple (fournisseur, code produit) — voir
// cadrage §4/§13 : le code produit fournisseur n'est unique QUE par fournisseur, jamais globalement
// (deux fournisseurs différents peuvent légitimement partager le même code, ce sont alors deux
// ProduitFournisseur distincts). Jamais de code inventé : articleId/designation proviennent toujours
// de la ligne réellement importée. Robuste à la concurrence : une violation de la contrainte unique
// (deux imports concurrents créant le même couple) est traitée comme "déjà créé par l'autre",
// jamais comme une erreur — la ligne relit alors ce que l'autre transaction vient de committer.
async function resoudreOuCreerProduitFournisseur(
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

export default router;
