import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import prisma from "../prisma.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// Aucun contrôle de format (email/téléphone/URL) : rien dans le schéma Prisma, le frontend
// (FournisseurForm.tsx n'utilise `type="email"` que pour le clavier mobile, jamais bloquant) ni les
// tests existants ne l'exige — ne pas en inventer un ici.
//
// `null` explicite est déjà accepté aujourd'hui exactement comme une absence de champ ou une
// chaîne vide (`telephone || null` : `null || null` vaut `null`) — `.nullable()` est donc
// nécessaire en plus de `.optional()`, sous peine de rejeter à tort un `null` que le contrat actuel
// tolère.
const champOptionnelVersNull = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

// nom non vide requis à la création — aucun .strict() : erreursEcritureFK.test.ts (test 2) prouve
// qu'une clé surnuméraire (ex. societeId) envoyée par le client doit être silencieusement ignorée,
// jamais provoquer un rejet.
const schemaCreation = z.object({
  nom: z.string().trim().min(1),
  telephone: champOptionnelVersNull,
  email: champOptionnelVersNull,
  siteWeb: champOptionnelVersNull,
});

// nom reste optionnel sur PUT : aujourd'hui, un nom omis devient `undefined` et Prisma `update`
// l'ignore (jamais écrasé) — comportement réel préservé tel quel, pas de symétrisation artificielle
// avec POST (voir caractérisation dédiée dans validationFournisseurs.test.ts).
const schemaModification = z.object({
  nom: z.string().trim().min(1).optional(),
  telephone: champOptionnelVersNull,
  email: champOptionnelVersNull,
  siteWeb: champOptionnelVersNull,
});

// Génère atomiquement le prochain codeFournisseur d'une société (format FOU-0001, FOU-0002, ...) —
// voir cadrage « identité fournisseur + produit fournisseur + historique des tarifs ». Un seul
// INSERT ... ON CONFLICT DO UPDATE ... RETURNING : atomique au niveau Postgres lui-même (jamais un
// SELECT MAX(...)+1 ni un COUNT(*)+1, non sûrs sous créations concurrentes — deux transactions
// concurrentes sur la même ligne de compteur se sérialisent au niveau du moteur, la seconde
// attend la première puis repart de la valeur déjà incrémentée). Doit toujours être appelée à
// l'intérieur de la même transaction que la création du Fournisseur qui utilisera ce code, pour
// qu'un échec de la création n'incrémente jamais le compteur pour rien (transaction annulée dans
// son ensemble). Exportée : réutilisée par trouverOuCreerFournisseur (articles.ts) pour que la
// création automatique d'un fournisseur pendant un import assigne elle aussi un code, exactement
// comme la création manuelle — jamais une seconde implémentation qui risquerait de diverger.
export async function genererCodeFournisseur(tx: Prisma.TransactionClient, societeId: number): Promise<string> {
  const lignes = await tx.$queryRaw<{ valeur: number }[]>`
    INSERT INTO "SocieteCompteur" ("societeId", "typeCompteur", "valeur")
    VALUES (${societeId}, 'FOURNISSEUR', 1)
    ON CONFLICT ("societeId", "typeCompteur")
    DO UPDATE SET "valeur" = "SocieteCompteur"."valeur" + 1
    RETURNING "valeur"
  `;
  const valeur = lignes[0].valeur;
  return `FOU-${String(valeur).padStart(4, "0")}`;
}

// inclureInactifs=true : aussi les fournisseurs désactivés (actif=false), pour permettre leur
// réactivation (voir POST /:id/reactiver) — sans ce paramètre, un fournisseur désactivé
// disparaissait de toute liste sans aucun moyen d'y revenir depuis l'interface.
router.get("/", async (req, res) => {
  try {
    const inclureInactifs = req.query.inclureInactifs === "true";
    const societeId = req.utilisateur!.societeId;
    const fournisseurs = await prisma.fournisseur.findMany({
      where: inclureInactifs ? { societeId } : { actif: true, societeId },
      include: { _count: { select: { tarifs: true } } },
      orderBy: { nom: "asc" },
    });

    res.json(fournisseurs);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer les fournisseurs" });
  }
});

// Fiche fournisseur (voir chantier listings/factures — Phase 5) : uniquement l'identifiant du
// fournisseur en paramètre, jamais un chemin arbitraire. Un 404 explicite distingue "fournisseur
// inexistant" d'une erreur serveur — le frontend ne doit jamais confondre les deux.
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Identifiant fournisseur invalide" });
      return;
    }

    const fournisseur = await prisma.fournisseur.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!fournisseur) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }

    res.json(fournisseur);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer ce fournisseur" });
  }
});

// Onglet "Articles / Tarifs" de la fiche fournisseur : tarifs actifs ET historiques (dateFin non
// nul inclus) — un tarif clôturé n'est jamais masqué, voir cadrage §7. La traçabilité vers le
// document source n'est incluse que lorsqu'elle existe réellement (voir ligneDocumentSource,
// Phase 2) : un tarif créé avant ce chantier ou manuellement n'a jamais de source inventée.
router.get("/:id/tarifs", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Identifiant fournisseur invalide" });
      return;
    }

    const fournisseur = await prisma.fournisseur.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!fournisseur) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }

    const tarifs = await prisma.tarifArticle.findMany({
      where: { fournisseurId: id },
      include: {
        article: { select: { id: true, nom: true, reference: true } },
        unite: { select: { symbole: true } },
        conditionnement: { select: { nom: true } },
        ligneDocumentSource: {
          select: {
            id: true,
            designationLue: true,
            document: { select: { id: true, type: true, cle: true, importeLe: true, nomFichierOriginal: true } },
          },
        },
      },
      orderBy: [{ article: { nom: "asc" } }, { dateDebut: "desc" }],
    });

    res.json(tarifs);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer les tarifs de ce fournisseur" });
  }
});

// Onglet "Listings" de la fiche fournisseur : documents importés (métadonnées seules — jamais le
// contenu du fichier, jamais un chemin, voir storageDocumentsFournisseur.ts). Les lignes détaillées
// d'un document précis sont chargées séparément (voir GET /listings-fournisseur/documents/:id),
// pour ne pas alourdir cette liste si un fournisseur a beaucoup de documents.
router.get("/:id/documents", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Identifiant fournisseur invalide" });
      return;
    }

    const fournisseur = await prisma.fournisseur.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!fournisseur) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }

    const documents = await prisma.documentFournisseur.findMany({
      where: { fournisseurId: id },
      include: { _count: { select: { lignes: true } } },
      orderBy: { importeLe: "desc" },
    });

    res.json(documents);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer les documents de ce fournisseur" });
  }
});

router.post("/", async (req, res) => {
  const parsed = schemaCreation.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Fournisseur invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const { nom, telephone, email, siteWeb } = parsed.data;
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma).
    const societeId = req.utilisateur!.societeId;

    // codeFournisseur n'est jamais lu depuis req.body : généré ici, jamais saisi, jamais dérivé du
    // nom (voir genererCodeFournisseur) — même transaction que la création pour que la génération
    // et l'écriture réussissent ou échouent ensemble.
    const fournisseur = await prisma.$transaction(async (tx) => {
      const codeFournisseur = await genererCodeFournisseur(tx, societeId);
      return tx.fournisseur.create({
        data: {
          nom,
          telephone: telephone || null,
          email: email || null,
          siteWeb: siteWeb || null,
          societeId,
          codeFournisseur,
        },
      });
    });

    res.status(201).json(fournisseur);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de créer le fournisseur", req);
  }
});

router.put("/:id", async (req, res) => {
  const parsed = schemaModification.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Fournisseur invalide", details: parsed.error.flatten() });
    return;
  }

  try {
    const id = Number(req.params.id);
    const { nom, telephone, email, siteWeb } = parsed.data;

    // Scopé par société : jamais permettre à un compte de modifier un fournisseur d'une autre
    // société en devinant/énumérant simplement un id (voir la matrice de permissions, server/app.ts).
    const existant = await prisma.fournisseur.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!existant) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }

    const fournisseur = await prisma.fournisseur.update({
      where: { id },
      data: {
        nom,
        telephone: telephone || null,
        email: email || null,
        siteWeb: siteWeb || null,
      },
    });

    res.json(fournisseur);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de modifier le fournisseur", req);
  }
});

// Suppression douce : un fournisseur peut rester référencé par l'historique des tarifs
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const { count } = await prisma.fournisseur.updateMany({
      where: { id, societeId: req.utilisateur!.societeId },
      data: { actif: false },
    });
    if (count === 0) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer le fournisseur" });
  }
});

// Réactivation explicite, distincte de PUT /:id — jamais automatique, jamais déclenchée en silence
// par un import (voir server/routes/articles.ts, server/routes/listingsFournisseur.ts : un code ou
// un nom retrouvant un fournisseur actif:false bloque toujours, sans jamais appeler cette route à
// leur place). Ne modifie que actif : id et codeFournisseur restent strictement inchangés — jamais
// régénérés, jamais réattribués.
router.post("/:id/reactiver", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Identifiant fournisseur invalide" });
      return;
    }

    const existant = await prisma.fournisseur.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!existant) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }

    const fournisseur = await prisma.fournisseur.update({ where: { id }, data: { actif: true } });

    res.json(fournisseur);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de réactiver le fournisseur" });
  }
});

export default router;
