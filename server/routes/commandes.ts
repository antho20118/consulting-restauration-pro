import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { calculerPropositionAchat, type LigneAchat } from "../utils/propositionAchat.js";
import { appliquerMouvementStock, StockInsuffisantError } from "../utils/mouvementStock.js";
import { libelleUniteBase } from "../utils/uniteConversion.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

const schemaCreation = z.object({
  depotId: z.number().int().positive(),
  besoins: z
    .array(
      z.object({
        articleId: z.number().int().positive(),
        quantite: z.number().positive(),
        facteurUniteRecette: z.number().positive(),
      })
    )
    .min(1),
});

const schemaReception = z.object({
  lignes: z
    .array(
      z.object({
        ligneId: z.number().int().positive(),
        quantiteRecueBase: z.number().min(0),
      })
    )
    .min(1),
});

// Le discriminant "statut" du membre A_COMMANDER/STOCK_SUFFISANT de LigneAchat est lui-même une
// union de deux littéraux au sein d'UN SEUL membre (voir propositionAchat.ts) : Extract<LigneAchat,
// { statut: "A_COMMANDER" }> résoudrait donc à `never` (le champ statut plus large n'est pas
// assignable au littéral seul). On isole ce membre par la présence de fournisseurId (propre à lui
// seul, absent des deux autres) puis on affine sur le statut réel via ce garde de type explicite.
type LigneAvecFournisseur = Extract<LigneAchat, { fournisseurId: number }>;
function estACommander(ligne: LigneAchat): ligne is LigneAvecFournisseur & { statut: "A_COMMANDER" } {
  return "fournisseurId" in ligne && ligne.statut === "A_COMMANDER";
}

const inclusionCommande = {
  include: {
    fournisseur: true,
    depot: true,
    lignes: {
      include: {
        article: {
          include: {
            tarifs: {
              where: { actif: true },
              orderBy: { dateDebut: "desc" as const },
              take: 1,
              include: { unite: true },
            },
          },
        },
      },
      orderBy: { id: "asc" as const },
    },
  },
};

// Ajoute, pour chaque ligne, le libellé de l'unité de base de son article (g/mL/pièce) déduite du
// tarif actif — même principe que mouvements.ts::mouvementAvecUniteBase — pour que les quantités
// (toujours stockées en unité de base, jamais l'unité d'achat du fournisseur) restent lisibles côté
// interface, en particulier dans le formulaire de réception.
function commandeAvecUniteBase<
  C extends { lignes: ({ article: { tarifs: { unite: { type: string } }[] } & Record<string, unknown> } & Record<string, unknown>)[] },
>(commande: C) {
  return {
    ...commande,
    lignes: commande.lignes.map((ligne) => {
      const { tarifs, ...article } = ligne.article;
      return { ...ligne, article: { ...article, uniteBase: libelleUniteBase(tarifs[0]?.unite.type) } };
    }),
  };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    // CommandeFournisseur n'a pas de societeId propre : scopé transitivement par le dépôt
    // (voir mouvements.ts, même principe).
    const commandes = await prisma.commandeFournisseur.findMany({
      where: { depot: { societeId: req.utilisateur!.societeId } },
      ...inclusionCommande,
      orderBy: { creeLe: "desc" },
    });
    res.json(commandes.map(commandeAvecUniteBase));
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer les commandes" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Identifiant de commande invalide" });
    return;
  }

  try {
    const commande = await prisma.commandeFournisseur.findFirst({
      where: { id, depot: { societeId: req.utilisateur!.societeId } },
      ...inclusionCommande,
    });
    if (!commande) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    res.json(commandeAvecUniteBase(commande));
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer cette commande" });
  }
});

// Enregistre une ou plusieurs commandes (une par fournisseur, voir cadrage « boucle achats
// complète ») à partir des mêmes besoins que POST /achats/proposition — toujours recalculés ici
// (jamais une proposition figée transmise par le client, voir calculerPropositionAchat) pour que
// la commande reflète l'état réel du stock/des tarifs au moment de l'écriture. Les lignes déjà
// couvertes par le stock (STOCK_SUFFISANT) ou sans fournisseur/article résolu ne sont jamais
// enregistrées : seules les lignes A_COMMANDER donnent lieu à une commande.
router.post("/", async (req: Request, res: Response) => {
  const parsed = schemaCreation.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Commande invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const { besoins, depotId } = parsed.data;
    const societeId = req.utilisateur!.societeId;

    // Scopé par société : jamais permettre de créer une commande pour un dépôt d'une autre société
    // en devinant/énumérant simplement un id.
    const depot = await prisma.depot.findFirst({ where: { id: depotId, societeId } });
    if (!depot) {
      res.status(404).json({ error: "Dépôt introuvable" });
      return;
    }

    const { lignes } = await calculerPropositionAchat(besoins, societeId, depotId);
    const lignesACommander = lignes.filter(estACommander);

    if (lignesACommander.length === 0) {
      res.status(201).json({ commandes: [] });
      return;
    }

    const lignesParFournisseur = new Map<number, typeof lignesACommander>();
    for (const ligne of lignesACommander) {
      const existantes = lignesParFournisseur.get(ligne.fournisseurId) ?? [];
      existantes.push(ligne);
      lignesParFournisseur.set(ligne.fournisseurId, existantes);
    }

    const commandes = await prisma.$transaction(async (tx) => {
      const resultats = [];
      for (const [fournisseurId, lignesFournisseur] of lignesParFournisseur) {
        const commande = await tx.commandeFournisseur.create({
          data: {
            fournisseurId,
            depotId,
            lignes: {
              create: lignesFournisseur.map((l) => ({
                articleId: l.articleId,
                conditionnementLibelle: l.conditionnement,
                conditionnements: l.conditionnements,
                quantiteCommandeeBase: l.quantiteCommandeeBase,
                prixUnitaireBase: l.prixUnitaireBase,
              })),
            },
          },
          ...inclusionCommande,
        });
        resultats.push(commande);
      }
      return resultats;
    });

    res.status(201).json({ commandes: commandes.map(commandeAvecUniteBase) });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'enregistrer la commande" });
  }
});

// Applique une réception : quantités réellement reçues, une seule fois par commande (jamais
// retraitée si déjà RECUE/RECUE_PARTIELLEMENT/ANNULEE). Toutes les lignes de la commande doivent
// être couvertes par la soumission — jamais une réception partielle silencieuse sur les lignes
// non mentionnées. Crée un MouvementStock ENTREE par ligne effectivement reçue (quantité > 0,
// voir appliquerMouvementStock) et met à jour Stock dans la même transaction ; le statut final
// (RECUE si toutes les lignes sont couvertes en totalité, RECUE_PARTIELLEMENT sinon) est déduit
// des quantités réellement soumises, jamais déclaré par le client.
router.post("/:id/receptionner", async (req: Request, res: Response) => {
  const commandeId = Number(req.params.id);
  if (!Number.isInteger(commandeId) || commandeId <= 0) {
    res.status(400).json({ error: "Identifiant de commande invalide" });
    return;
  }

  const parsed = schemaReception.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Réception invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const commande = await prisma.commandeFournisseur.findFirst({
      where: { id: commandeId, depot: { societeId: req.utilisateur!.societeId } },
      include: { lignes: true },
    });
    if (!commande) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    if (commande.statut !== "EN_ATTENTE") {
      res.status(409).json({ error: "Cette commande a déjà été traitée" });
      return;
    }

    const ligneParId = new Map(commande.lignes.map((l) => [l.id, l]));
    const idsSoumis = new Set(parsed.data.lignes.map((l) => l.ligneId));
    // Un ligneId répété passerait silencieusement le contrôle de couverture ci-dessous (basé sur ce
    // même Set, qui dédoublonne) alors que la boucle de traitement plus bas itère sur
    // parsed.data.lignes tel quel : chaque occurrence appliquerait son propre mouvement de stock,
    // incrémentant Stock.quantite une fois par occurrence au lieu d'une fois par ligne réelle.
    if (idsSoumis.size !== parsed.data.lignes.length) {
      res.status(400).json({ error: "La réception contient des lignes dupliquées" });
      return;
    }
    if (idsSoumis.size !== commande.lignes.length || commande.lignes.some((l) => !idsSoumis.has(l.id))) {
      res.status(400).json({ error: "La réception doit porter sur toutes les lignes de la commande" });
      return;
    }
    for (const entree of parsed.data.lignes) {
      if (!ligneParId.has(entree.ligneId)) {
        res.status(400).json({ error: `Ligne ${entree.ligneId} n'appartient pas à cette commande` });
        return;
      }
    }

    const resultat = await prisma.$transaction(async (tx) => {
      let toutRecu = true;
      for (const entree of parsed.data.lignes) {
        const ligne = ligneParId.get(entree.ligneId)!;
        let mouvementStockId: number | null = null;

        if (entree.quantiteRecueBase > 0) {
          const mouvement = await appliquerMouvementStock(tx, {
            articleId: ligne.articleId,
            depotId: commande.depotId,
            type: "ENTREE",
            quantite: entree.quantiteRecueBase,
            motif: `Réception commande fournisseur #${commande.id}`,
          });
          mouvementStockId = mouvement.id;
        }
        if (entree.quantiteRecueBase < ligne.quantiteCommandeeBase) toutRecu = false;

        await tx.ligneCommandeFournisseur.update({
          where: { id: ligne.id },
          data: { quantiteRecueBase: entree.quantiteRecueBase, mouvementStockId },
        });
      }

      return tx.commandeFournisseur.update({
        where: { id: commandeId },
        data: { statut: toutRecu ? "RECUE" : "RECUE_PARTIELLEMENT", dateReception: new Date() },
        ...inclusionCommande,
      });
    });

    res.json(commandeAvecUniteBase(resultat));
  } catch (error) {
    if (error instanceof StockInsuffisantError) {
      // Ne peut structurellement pas se produire sur une ENTREE (le stock ne peut que monter),
      // mais gardé pour ne jamais faire dépendre la sécurité de ce chemin d'une hypothèse
      // implicite sur ce que fait appliquerMouvementStock.
      res.status(500).json({ error: "Impossible d'appliquer ce mouvement de stock" });
      return;
    }
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'enregistrer la réception" });
  }
});

// Annule une commande jamais réceptionnée (erreur de saisie, fournisseur ne pouvant honorer la
// commande...) — jamais une commande déjà (partiellement) reçue, pour ne jamais masquer un
// mouvement de stock déjà appliqué.
router.post("/:id/annuler", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Identifiant de commande invalide" });
    return;
  }

  try {
    const commande = await prisma.commandeFournisseur.findFirst({
      where: { id, depot: { societeId: req.utilisateur!.societeId } },
    });
    if (!commande) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    if (commande.statut !== "EN_ATTENTE") {
      res.status(409).json({ error: "Seule une commande en attente peut être annulée" });
      return;
    }

    const misAJour = await prisma.commandeFournisseur.update({
      where: { id },
      data: { statut: "ANNULEE" },
      ...inclusionCommande,
    });
    res.json(commandeAvecUniteBase(misAJour));
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'annuler cette commande" });
  }
});

export default router;
