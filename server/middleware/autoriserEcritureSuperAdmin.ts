import type { Request, Response, NextFunction } from "express";

import prisma from "../prisma.js";

const METHODES_ECRITURE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Référentiels volontairement partagés entre toutes les sociétés (TVA, Unite — voir F11 de
// l'audit forensique et les commentaires de ces deux modèles dans schema.prisma) : la lecture
// reste ouverte à tout rôle authentifié (nécessaire à tous les formulaires qui proposent un taux
// de TVA ou une unité), mais l'écriture est réservée à l'opérateur de la plateforme — un simple
// PROPRIETAIRE de société ne doit jamais pouvoir modifier/supprimer une ligne utilisée par les
// autres sociétés. Même garde-fou que requireSuperAdmin.ts : relit toujours le flag en base,
// jamais via le jeton (qui ne le porte pas).
export async function autoriserEcritureSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!METHODES_ECRITURE.has(req.method)) {
    next();
    return;
  }
  if (!req.utilisateur) {
    res.status(401).json({ error: "Authentification requise" });
    return;
  }

  const utilisateur = await prisma.utilisateur.findUnique({ where: { id: req.utilisateur.id } });
  if (!utilisateur?.superAdmin) {
    res.status(403).json({ error: "Réservé à l'opérateur de la plateforme" });
    return;
  }

  next();
}
