import type { Request, Response, NextFunction } from "express";
import type { PayloadUtilisateur } from "../utils/auth.js";

// Restreint un routeur/une route entière à une liste de rôles, quelle que soit la méthode HTTP —
// pour les endpoints sensibles dans leur ensemble (gestion des comptes, paramètres société), jamais
// utilisé pour un routeur métier où la lecture doit rester ouverte à tous les rôles authentifiés
// (voir autoriserEcriture.ts pour ce cas, plus courant).
export function requireRole(rolesAutorises: PayloadUtilisateur["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.utilisateur || !rolesAutorises.includes(req.utilisateur.role)) {
      res.status(403).json({ error: "Rôle insuffisant pour cette action" });
      return;
    }
    next();
  };
}
