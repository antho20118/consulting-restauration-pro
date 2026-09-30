import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma, RoleUtilisateur } from "@prisma/client";

import prisma from "../prisma.js";
import { hacherCode } from "../utils/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

// Gestion des comptes : réservée au PROPRIETAIRE, jamais au CHEF (voir la matrice de permissions,
// server/app.ts) — un chef de cuisine gère la brigade, pas les accès à l'application.
router.use(requireRole(["PROPRIETAIRE"]));

const schemaCreation = z.object({
  identifiant: z.string().trim().min(1).max(100),
  code: z.string().min(6).max(200),
  role: z.nativeEnum(RoleUtilisateur),
});
const schemaModification = z.object({
  role: z.nativeEnum(RoleUtilisateur).optional(),
  actif: z.boolean().optional(),
});
const schemaReinitialisationCode = z.object({
  nouveauCode: z.string().min(6).max(200),
});

// Toujours scopé à la société de la personne connectée : jamais une liste globale tous comptes
// confondus, même pour un PROPRIETAIRE (voir la dérivation de societeId depuis req.utilisateur,
// jamais depuis le corps de la requête).
router.get("/", async (req: Request, res: Response) => {
  try {
    const utilisateurs = await prisma.utilisateur.findMany({
      where: { societeId: req.utilisateur!.societeId },
      select: { id: true, identifiant: true, role: true, actif: true, createdAt: true },
      orderBy: { identifiant: "asc" },
    });

    res.json(utilisateurs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les comptes" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const analyse = schemaCreation.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Identifiant, code (6 caractères min.) et rôle requis" });
      return;
    }
    const { identifiant, code, role } = analyse.data;

    const utilisateur = await prisma.utilisateur.create({
      data: {
        identifiant,
        codeHache: hacherCode(code),
        role,
        societeId: req.utilisateur!.societeId,
      },
      select: { id: true, identifiant: true, role: true, actif: true, createdAt: true },
    });

    res.status(201).json(utilisateur);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "Cet identifiant est déjà utilisé par un autre compte" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Impossible de créer le compte" });
  }
});

// Ne modifie jamais l'identifiant ni le code ici — voir /:id/reinitialiser-code pour le code
// (un PROPRIETAIRE peut réinitialiser le code de quelqu'un d'autre, jamais le lire) et PUT
// /auth/moi pour que chacun modifie son propre identifiant.
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const analyse = schemaModification.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Rôle ou statut actif invalide" });
      return;
    }

    const cible = await prisma.utilisateur.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!cible) {
      res.status(404).json({ error: "Compte introuvable" });
      return;
    }

    const desactive = analyse.data.actif === false;
    const retrograde = analyse.data.role !== undefined && analyse.data.role !== "PROPRIETAIRE";
    if (cible.role === "PROPRIETAIRE" && (desactive || retrograde)) {
      const autresProprietairesActifs = await prisma.utilisateur.count({
        where: {
          societeId: req.utilisateur!.societeId,
          role: "PROPRIETAIRE",
          actif: true,
          id: { not: id },
        },
      });
      // Jamais laisser une société sans aucun PROPRIETAIRE actif : sinon plus personne ne peut
      // gérer les comptes, y compris pour corriger cette même situation.
      if (autresProprietairesActifs === 0) {
        res.status(409).json({
          error: "Impossible : ce compte est le dernier propriétaire actif de la société",
        });
        return;
      }
    }

    const utilisateur = await prisma.utilisateur.update({
      where: { id },
      data: analyse.data,
      select: { id: true, identifiant: true, role: true, actif: true, createdAt: true },
    });

    res.json(utilisateur);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier le compte" });
  }
});

// Un PROPRIETAIRE peut débloquer un compte qui a oublié son code (aucun flux d'auto-réinitialisation
// par e-mail dans l'application) — mais ne voit ni ne choisit jamais l'ancien code, seulement le
// nouveau, saisi par la personne concernée avant d'être transmis ici.
router.post("/:id/reinitialiser-code", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const analyse = schemaReinitialisationCode.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Le nouveau code doit faire au moins 6 caractères" });
      return;
    }

    const cible = await prisma.utilisateur.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
    });
    if (!cible) {
      res.status(404).json({ error: "Compte introuvable" });
      return;
    }

    await prisma.utilisateur.update({
      where: { id },
      data: { codeHache: hacherCode(analyse.data.nouveauCode) },
    });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de réinitialiser le code" });
  }
});

export default router;
