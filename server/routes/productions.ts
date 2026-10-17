import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import prisma from "../prisma.js";
import { planifierProduction, type CibleProduction } from "../utils/planifierProduction.js";
import { evaluerEtapesHACCP } from "../utils/haccp.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";
import { appliquerMouvementStock, StockInsuffisantError } from "../utils/mouvementStock.js";
import { idUrlValide } from "../utils/idUrl.js";
import { UniteIncompatibleError } from "../utils/coutRecette.js";

const router = Router();

// Saisie faite hors connexion puis rejouée par la file d'attente du téléphone (src/offline/, point 9
// de l'audit du 15/10) : clé unique de la saisie (son idLocal) et moment réel de la saisie. Les deux
// sont absents en ligne, où le comportement reste inchangé (heure du serveur).
const champsSaisieHorsLigne = {
  cleIdempotence: z.uuid().optional(),
};

const schemaCreation = z.object({
  ...champsSaisieHorsLigne,
  realiseeLe: z.iso.datetime({ offset: true }).optional(),
  recetteId: z.number().int().positive(),
  depotId: z.number().int().positive().optional(),
  cible: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("portions"), valeur: z.number().positive() }),
    z.object({ mode: z.literal("poidsFiniG"), valeur: z.number().positive() }),
  ]),
});

const schemaControle = z.object({
  ...champsSaisieHorsLigne,
  constateLe: z.iso.datetime({ offset: true }).optional(),
  recetteEtapeId: z.number().int().positive(),
  valeur: z.string().trim().min(1, "La valeur constatée est obligatoire"),
  conforme: z.boolean(),
  commentaire: z.string().trim().optional(),
});

// Heure déclarée par l'appareil pour une saisie faite hors connexion. Bornée pour qu'elle ne puisse
// pas servir à falsifier la traçabilité : jamais dans le futur (un appareil à l'heure fausse, en
// avance, reçoit l'heure du serveur), jamais plus de 7 jours en arrière (refusé). L'heure de
// réception par le serveur reste de toute façon enregistrée à part (createdAt) et affichée quand
// elle diffère.
const ANCIENNETE_MAX_MS = 7 * 24 * 3600_000;

class HorodatageTropAncienError extends Error {}

function horodatageDeclare(valeur: string | undefined): Date {
  const maintenant = new Date();
  if (!valeur) return maintenant;
  const declaree = new Date(valeur);
  if (declaree.getTime() > maintenant.getTime()) return maintenant;
  if (maintenant.getTime() - declaree.getTime() > ANCIENNETE_MAX_MS) {
    throw new HorodatageTropAncienError(
      "Saisie de plus de 7 jours : elle ne peut plus être enregistrée avec sa date d'origine."
    );
  }
  return declaree;
}

function estCleDejaUtilisee(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Même saisie déjà reçue (renvoi après une réponse perdue, ou deux envois simultanés) : renvoie la
// production existante — jamais une seconde production ni une seconde déduction de stock. Une clé
// déjà prise par une autre société est refusée sans rien en révéler.
async function repondreSiProductionDejaRecue(
  cleIdempotence: string | undefined,
  societeId: number,
  res: Response
): Promise<boolean> {
  if (!cleIdempotence) return false;
  const existante = await prisma.production.findUnique({ where: { cleIdempotence }, ...inclusionProduction });
  if (!existante) return false;
  if (existante.societeId !== societeId) {
    res.status(409).json({ error: "Cette saisie a déjà été utilisée" });
    return true;
  }
  res.status(200).json({ ...existante, etapesCritiques: await etapesCritiquesDeLaRecette(existante.recetteId, societeId) });
  return true;
}

// Même principe que repondreSiProductionDejaRecue, pour un contrôle HACCP : renvoie l'état actuel
// de sa production, sans enregistrer un second contrôle.
async function repondreSiControleDejaRecu(
  cleIdempotence: string | undefined,
  production: { id: number; recetteId: number; societeId: number },
  res: Response
): Promise<boolean> {
  if (!cleIdempotence) return false;
  const existant = await prisma.controleHACCPProduction.findUnique({ where: { cleIdempotence } });
  if (!existant) return false;
  if (existant.productionId !== production.id) {
    res.status(409).json({ error: "Cette saisie a déjà été utilisée" });
    return true;
  }
  const actuelle = await prisma.production.findUnique({ where: { id: production.id }, ...inclusionProduction });
  res.status(200).json({ ...actuelle, etapesCritiques: await etapesCritiquesDeLaRecette(production.recetteId, production.societeId) });
  return true;
}

const inclusionProduction = {
  include: {
    recette: { select: { id: true, nom: true } },
    depot: { select: { id: true, nom: true } },
    controles: { orderBy: { dateHeure: "desc" as const } },
  },
};

// Réévalue les points critiques HACCP de la recette au moment de la consultation (jamais figés à
// la création de la production) : une recette peut évoluer après coup (nouvelle étape marquée
// point critique, procédure de contrôle modifiée) et la production existante doit refléter l'état
// actuel de sa propre recette, pas un instantané obsolète — les contrôles déjà enregistrés, eux,
// restent inchangés (voir ControleHACCPProduction, jamais réécrit).
async function etapesCritiquesDeLaRecette(recetteId: number, societeId: number) {
  const recette = await prisma.recette.findFirst({
    where: { id: recetteId, societeId },
    include: { etapes: { orderBy: { ordre: "asc" } } },
  });
  if (!recette) return [];
  return evaluerEtapesHACCP(recette.etapes).filter(
    (etape) => etape.reglesDetectees.length > 0 || etape.pointCritiqueHACCP
  );
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const societeId = req.utilisateur!.societeId;
    const productions = await prisma.production.findMany({
      where: { societeId },
      ...inclusionProduction,
      orderBy: { dateProduction: "desc" },
    });

    // Résumé HACCP par production (nombre de points critiques de la recette / nombre déjà
    // contrôlés au moins une fois) — un seul calcul par recette distincte, jamais un par
    // production, même si plusieurs productions partagent la même recette.
    const etapesParRecette = new Map<number, Awaited<ReturnType<typeof etapesCritiquesDeLaRecette>>>();
    const resultats = [];
    for (const production of productions) {
      if (!etapesParRecette.has(production.recetteId)) {
        etapesParRecette.set(production.recetteId, await etapesCritiquesDeLaRecette(production.recetteId, societeId));
      }
      const etapesCritiques = etapesParRecette.get(production.recetteId)!;
      const etapesControlees = new Set(production.controles.map((c) => c.recetteEtapeId));
      resultats.push({
        ...production,
        pointsCritiquesTotal: etapesCritiques.length,
        pointsCritiquesControles: etapesCritiques.filter((e) => etapesControlees.has(e.id)).length,
      });
    }

    res.json(resultats);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer les productions" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!idUrlValide(id) || id <= 0) {
    res.status(400).json({ error: "Identifiant de production invalide" });
    return;
  }

  try {
    const societeId = req.utilisateur!.societeId;
    // Scopé par société : jamais permettre de consulter une production d'une autre société en
    // devinant/énumérant simplement un id (voir la matrice de permissions, server/app.ts).
    const production = await prisma.production.findFirst({ where: { id, societeId }, ...inclusionProduction });
    if (!production) {
      res.status(404).json({ error: "Production introuvable" });
      return;
    }
    const etapesCritiques = await etapesCritiquesDeLaRecette(production.recetteId, societeId);
    res.json({ ...production, etapesCritiques });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer cette production" });
  }
});

// Enregistre une production réellement réalisée — les quantités (portions/poids) sont toujours
// recalculées ici via planifierProduction (jamais transmises telles quelles par le client), même
// principe que la commande fournisseur (voir calculerPropositionAchat côté commandes.ts) : la
// production doit refléter l'état réel de la recette au moment de l'enregistrement.
router.post("/", async (req: Request, res: Response) => {
  const parsed = schemaCreation.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Production invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const { recetteId, depotId, cible, cleIdempotence } = parsed.data;
    const societeId = req.utilisateur!.societeId;
    const dateProduction = horodatageDeclare(parsed.data.realiseeLe);

    if (await repondreSiProductionDejaRecue(cleIdempotence, societeId, res)) return;

    // Scopé par société : jamais permettre d'enregistrer une production pour une recette d'une
    // autre société en devinant/énumérant simplement un id (voir la matrice de permissions,
    // server/app.ts) — le societeId de la production vient toujours de l'identité connectée,
    // jamais de la recette ou d'un champ transmis par le client.
    const recette = await prisma.recette.findFirst({ where: { id: recetteId, societeId }, select: { id: true } });
    if (!recette) {
      res.status(404).json({ error: "Recette introuvable" });
      return;
    }

    const planification = await planifierProduction(recetteId, cible as CibleProduction, societeId, depotId);

    // Création de la production et déduction du stock consommé dans la même transaction : si le
    // stock est insuffisant pour un seul ingrédient, toute la production est annulée (aucune
    // écriture partielle, ni la production ni un mouvement de stock) — même règle "le stock ne
    // descend jamais sous zéro" qu'ailleurs (voir appliquerMouvementStock, server/utils/mouvementStock.ts).
    const production = await prisma.$transaction(async (tx) => {
      // Qui a réellement enregistré cette production — traçabilité (voir Production.creeParId,
      // prisma/schema.prisma), jamais l'identité fournie par le client.
      const production = await tx.production.create({
        data: {
          recetteId,
          societeId,
          depotId,
          portionsProduites: planification.portionsCible,
          poidsFiniProduitG: planification.poidsFiniCibleG,
          creeParId: req.utilisateur!.id,
          dateProduction,
          cleIdempotence,
        },
        ...inclusionProduction,
      });

      // Sans dépôt choisi, aucune déduction de stock (comportement préexistant : une production
      // "hors stock", ex. recette non suivie en stock) — les quantités sont déjà en unité de base,
      // comme Stock.quantite (voir planifierProduction.ts).
      if (depotId != null) {
        for (const ligne of planification.lignes) {
          if (ligne.quantiteProduction <= 0) continue;
          await appliquerMouvementStock(tx, {
            articleId: ligne.articleId,
            depotId,
            type: "SORTIE",
            quantite: ligne.quantiteProduction,
            motif: `Production #${production.id}`,
            productionId: production.id,
          });
        }
      }

      return production;
    });

    const etapesCritiques = await etapesCritiquesDeLaRecette(recetteId, societeId);
    res.status(201).json({ ...production, etapesCritiques });
  } catch (error) {
    if (error instanceof HorodatageTropAncienError) {
      res.status(400).json({ error: error.message });
      return;
    }
    // Deux envois simultanés de la même saisie : le second bute sur la clé unique.
    if (estCleDejaUtilisee(error) && (await repondreSiProductionDejaRecue(parsed.data.cleIdempotence, req.utilisateur!.societeId, res))) {
      return;
    }
    if (error instanceof StockInsuffisantError) {
      res.status(400).json({ error: "Stock insuffisant pour enregistrer cette production" });
      return;
    }
    // Unité d'une ligne incompatible avec le tarif de son ingrédient (voir
    // UniteIncompatibleError) : aucune production ni déduction de stock tant que la recette n'est
    // pas corrigée.
    if (error instanceof UniteIncompatibleError) {
      res.status(400).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Impossible d'enregistrer la production";
    const statutHttp = message === "Recette introuvable" ? 404 : 500;
    if (statutHttp === 500) {
      console.error(error);
      await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    }
    res.status(statutHttp).json({ error: message });
  }
});

// Ajoute un contrôle HACCP daté pour un point critique de cette production — jamais modifiable ni
// supprimable après coup (aucune route PATCH/DELETE, voir ControleHACCPProduction) : une erreur de
// saisie se corrige en ajoutant un nouveau contrôle, jamais en réécrivant l'historique. dateHeure
// est l'heure serveur, sauf pour un contrôle saisi hors connexion : l'heure de la saisie, bornée
// (voir horodatageDeclare) pour qu'elle ne puisse pas falsifier la traçabilité ; l'heure de
// réception reste enregistrée à part (createdAt).
router.post("/:id/controles", async (req: Request, res: Response) => {
  const productionId = Number(req.params.id);
  if (!idUrlValide(productionId) || productionId <= 0) {
    res.status(400).json({ error: "Identifiant de production invalide" });
    return;
  }

  const parsed = schemaControle.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Contrôle invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const societeId = req.utilisateur!.societeId;
    // Scopé par société : jamais permettre d'ajouter un contrôle à une production d'une autre
    // société en devinant/énumérant simplement un id (voir la matrice de permissions, server/app.ts).
    const production = await prisma.production.findFirst({ where: { id: productionId, societeId } });
    if (!production) {
      res.status(404).json({ error: "Production introuvable" });
      return;
    }

    const etape = await prisma.recetteEtape.findUnique({ where: { id: parsed.data.recetteEtapeId } });
    if (!etape || etape.recetteId !== production.recetteId) {
      res.status(400).json({ error: "Cette étape n'appartient pas à la recette de cette production" });
      return;
    }

    if (await repondreSiControleDejaRecu(parsed.data.cleIdempotence, production, res)) return;
    const dateHeure = horodatageDeclare(parsed.data.constateLe);

    await prisma.controleHACCPProduction.create({
      data: {
        productionId,
        recetteEtapeId: parsed.data.recetteEtapeId,
        dateHeure,
        cleIdempotence: parsed.data.cleIdempotence,
        valeur: parsed.data.valeur,
        conforme: parsed.data.conforme,
        commentaire: parsed.data.commentaire || null,
        // Qui a réellement constaté cette valeur — traçabilité (voir
        // ControleHACCPProduction.creeParId, prisma/schema.prisma), jamais l'identité fournie par
        // le client.
        creeParId: req.utilisateur!.id,
      },
    });

    const misAJour = await prisma.production.findUnique({ where: { id: productionId }, ...inclusionProduction });
    const etapesCritiques = await etapesCritiquesDeLaRecette(production.recetteId, societeId);
    res.status(201).json({ ...misAJour, etapesCritiques });
  } catch (error) {
    if (error instanceof HorodatageTropAncienError) {
      res.status(400).json({ error: error.message });
      return;
    }
    // Deux envois simultanés du même contrôle : le second bute sur la clé unique.
    if (estCleDejaUtilisee(error)) {
      const production = await prisma.production.findFirst({ where: { id: productionId, societeId: req.utilisateur!.societeId } });
      if (production && (await repondreSiControleDejaRecu(parsed.data.cleIdempotence, production, res))) return;
    }
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'enregistrer ce contrôle" });
  }
});

export default router;
