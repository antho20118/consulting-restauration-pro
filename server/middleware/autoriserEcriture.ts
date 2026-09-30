import type { Request, Response, NextFunction } from "express";
import type { PayloadUtilisateur } from "../utils/auth.js";

const METHODES_ECRITURE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Matrice de permissions par rôle (voir server/app.ts pour le détail groupe par groupe) : la
// lecture (GET) reste toujours ouverte à tout rôle authentifié de la société — seule l'écriture est
// bornée par ce middleware, monté par groupe de routeurs plutôt qu'éparpillé route par route, pour
// que la matrice entière reste lisible en un seul endroit (server/app.ts) plutôt que déduite en
// piochant dans 24 fichiers de routes.
export function autoriserEcriture(rolesAutorises: PayloadUtilisateur["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!METHODES_ECRITURE.has(req.method)) {
      next();
      return;
    }
    if (!req.utilisateur || !rolesAutorises.includes(req.utilisateur.role)) {
      res.status(403).json({ error: "Rôle insuffisant pour cette action" });
      return;
    }
    next();
  };
}
