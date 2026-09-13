import type { Request, Response, NextFunction } from "express";
import { verifierToken } from "../utils/auth.js";

// Protège toutes les routes /api/* (sauf /api/auth/login, montée avant ce middleware) : sans
// cette vérification côté serveur, l'écran de connexion ne serait qu'une façade côté client,
// contournable en appelant l'API directement.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const entete = req.headers.authorization;
  const token = entete?.startsWith("Bearer ") ? entete.slice(7) : null;

  if (!token || !verifierToken(token)) {
    res.status(401).json({ error: "Authentification requise" });
    return;
  }

  next();
}
