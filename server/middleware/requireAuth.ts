import type { Request, Response, NextFunction } from "express";
import { verifierToken } from "../utils/auth.js";
import prisma from "../prisma.js";

// Protège toutes les routes /api/* (sauf /api/auth/login, montée avant ce middleware) : sans
// cette vérification côté serveur, l'écran de connexion ne serait qu'une façade côté client,
// contournable en appelant l'API directement.
//
// Peuple req.utilisateur à partir du COMPTE en base désigné par le jeton (id, rôle, societeId) :
// c'est cette identité, jamais un societeId envoyé par le client, qui doit scoper toute
// lecture/écriture (voir le chantier de dérivation dans chaque routeur) — et c'est ce qui permet à
// un compte désactivé, rétrogradé ou dont le code a changé d'être pris en compte immédiatement (voir
// les vérifications ci-dessous), pas seulement à l'expiration du jeton.
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

  // Jeton émis avant un changement de code (voir Utilisateur.sessionsInvalideesLe) : refusé, sans
  // attendre son expiration. Comparaison à la seconde (iat est en secondes) : un jeton émis dans la
  // seconde même de l'invalidation — en particulier celui que PUT /api/auth/moi renvoie aussitôt —
  // reste accepté.
  if (
    utilisateur.sessionsInvalideesLe &&
    (typeof payload.iat !== "number" ||
      payload.iat < Math.floor(utilisateur.sessionsInvalideesLe.getTime() / 1000))
  ) {
    res.status(401).json({ error: "Session expirée, reconnecte-toi" });
    return;
  }

  // Rôle et société relus en base à chaque requête, jamais pris dans le jeton : un rôle retiré (ou
  // accordé) par un PROPRIETAIRE prend effet immédiatement, pas seulement à l'expiration du jeton
  // (12 h) — un PROPRIETAIRE rétrogradé ne doit plus pouvoir gérer les comptes une seconde de plus.
  req.utilisateur = {
    id: utilisateur.id,
    identifiant: utilisateur.identifiant,
    role: utilisateur.role,
    societeId: utilisateur.societeId,
  };
  next();
}
