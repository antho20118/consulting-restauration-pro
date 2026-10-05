import type { Request, Response, NextFunction } from "express";
import prisma from "../prisma.js";

// Réservé aux routes cross-société (aujourd'hui : GET /api/sauvegardes, qui exporte TOUTES les
// sociétés sans filtre — voir prisma/sauvegarder.ts). requireRole(["PROPRIETAIRE"]) ne suffit pas
// ici : ce rôle ne borne les droits qu'À L'INTÉRIEUR d'une société, alors que superAdmin identifie
// l'opérateur de la plateforme elle-même (voir le commentaire du champ dans schema.prisma).
//
// Relit toujours le flag en base (jamais via le jeton, qui ne le porte pas) — même principe que
// "actif" dans requireAuth.ts : un retrait de superAdmin doit prendre effet immédiatement, pas
// seulement à l'expiration du jeton (12h).
export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
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
