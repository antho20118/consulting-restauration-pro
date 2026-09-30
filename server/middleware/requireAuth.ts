import type { Request, Response, NextFunction } from "express";
import { verifierToken } from "../utils/auth.js";
import prisma from "../prisma.js";

// Protège toutes les routes /api/* (sauf /api/auth/login, montée avant ce middleware) : sans
// cette vérification côté serveur, l'écran de connexion ne serait qu'une façade côté client,
// contournable en appelant l'API directement.
//
// Peuple req.utilisateur à partir du jeton décodé (id, rôle, societeId) : c'est cette identité,
// jamais un societeId envoyé par le client, qui doit désormais scoper toute lecture/écriture (voir
// le chantier de dérivation dans chaque routeur) — et c'est ce qui permet à un compte désactivé
// entre-temps d'être immédiatement bloqué (voir la vérification "actif" ci-dessous), pas seulement
// à l'expiration du jeton.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const entete = req.headers.authorization;
  const token = entete?.startsWith("Bearer ") ? entete.slice(7) : null;
  const payload = token ? verifierToken(token) : null;

  // Un jeton signé avant la refonte des comptes nominatifs (ancien identifiant/code partagé, voir
  // l'historique de ce fichier) reste valide jusqu'à son expiration (12h) mais ne porte pas ce
  // payload : sans cette vérification, la requête Prisma ci-dessous plante (id manquant) au lieu
  // de renvoyer un 401 propre — qui déclenche déjà la déconnexion automatique côté client (voir
  // apiFetch, config/api.ts).
  if (!payload || typeof payload.id !== "number") {
    res.status(401).json({ error: "Authentification requise" });
    return;
  }

  const utilisateur = await prisma.utilisateur.findUnique({ where: { id: payload.id } });
  if (!utilisateur || !utilisateur.actif) {
    res.status(401).json({ error: "Compte désactivé ou introuvable" });
    return;
  }

  req.utilisateur = payload;
  next();
}
