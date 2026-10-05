import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { planifierProduction, type CibleProduction } from "../utils/planifierProduction.js";
import { evaluerEtapesHACCP } from "../utils/haccp.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";
import { appliquerMouvementStock, StockInsuffisantError } from "../utils/mouvementStock.js";

const router = Router();

const schemaCreation = z.object({
  recetteId: z.number().int().positive(),
  depotId: z.number().int().positive().optional(),
  cible: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("portions"), valeur: z.number().positive() }),
    z.object({ mode: z.literal("poidsFiniG"), valeur: z.number().positive() }),
  ]),
});

const schemaControle = z.object({
  recetteEtapeId: z.number().int().positive(),
  valeur: z.string().trim().min(1, "La valeur constatée est obligatoire"),
  conforme: z.boolean(),
  commentaire: z.string().trim().optional(),
});

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
  if (!Number.isInteger(id) || id <= 0) {
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
    const { recetteId, depotId, cible } = parsed.data;
    const societeId = req.utilisateur!.societeId;

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
    if (error instanceof StockInsuffisantError) {
      res.status(400).json({ error: "Stock insuffisant pour enregistrer cette production" });
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
// est toujours l'heure serveur au moment de l'enregistrement, jamais une date fournie par le
// client (un horodatage falsifiable viderait la traçabilité de son sens).
router.post("/:id/controles", async (req: Request, res: Response) => {
  const productionId = Number(req.params.id);
  if (!Number.isInteger(productionId) || productionId <= 0) {
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

    await prisma.controleHACCPProduction.create({
      data: {
        productionId,
        recetteEtapeId: parsed.data.recetteEtapeId,
        dateHeure: new Date(),
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
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'enregistrer ce contrôle" });
  }
});

export default router;
