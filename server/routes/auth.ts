import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { creerToken, hacherCode, verifierCode } from "../utils/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const schemaLogin = z.object({
  identifiant: z.string().trim().min(1).max(100),
  code: z.string().min(1).max(200),
});
const schemaChangement = z.object({
  codeActuel: z.string().min(1).max(200),
  nouvelIdentifiant: z.string().trim().min(1).max(100),
  nouveauCode: z.string().min(6).max(200),
});

// Limitation simple des tentatives de connexion par IP : un identifiant/code partagé par toute
// l'équipe est une cible facile pour un essai automatisé exhaustif, sans avoir à cibler un compte
// nominatif précis. Volontairement en mémoire (pas de dépendance ajoutée) : suffisant pour une
// seule instance de serveur, se réinitialise à un redémarrage.
const tentativesParIp = new Map<string, { compte: number; expire: number }>();
const FENETRE_MS = 15 * 60_000;
const MAX_TENTATIVES = 10;

function autoriseTentative(ip: string): boolean {
  const maintenant = Date.now();
  const entree = tentativesParIp.get(ip);
  if (!entree || entree.expire <= maintenant) {
    tentativesParIp.set(ip, { compte: 1, expire: maintenant + FENETRE_MS });
    return true;
  }
  if (entree.compte >= MAX_TENTATIVES) return false;
  entree.compte += 1;
  return true;
}

// Connexion : un seul identifiant/code partagé pour toute l'équipe (pas de compte nominatif).
router.post("/login", async (req: Request, res: Response) => {
  try {
    if (!autoriseTentative(req.ip ?? "inconnu")) {
      res.status(429).json({ error: "Trop de tentatives. Réessaie dans quelques minutes." });
      return;
    }

    const analyse = schemaLogin.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Identifiant et code requis" });
      return;
    }
    const { identifiant, code } = analyse.data;

    const acces = await prisma.accesApplication.findFirst();

    if (!acces || acces.identifiant !== identifiant || !verifierCode(code, acces.codeHache)) {
      res.status(401).json({ error: "Identifiant ou code incorrect" });
      return;
    }

    res.json({ token: creerToken(identifiant) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de se connecter" });
  }
});

// Changement de l'identifiant/code partagé (depuis Paramètres) : nécessite d'être déjà connecté
// et de confirmer le code actuel.
router.put("/identifiants", requireAuth, async (req: Request, res: Response) => {
  try {
    const analyse = schemaChangement.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Tous les champs sont requis (le nouveau code doit faire au moins 6 caractères)" });
      return;
    }
    const { codeActuel, nouvelIdentifiant, nouveauCode } = analyse.data;

    const acces = await prisma.accesApplication.findFirst();

    // 403 (et non 401) : la session est valide (on a passé requireAuth), seul le code actuel
    // saisi est refusé. Un 401 ici serait intercepté par apiFetch comme une session expirée et
    // déconnecterait l'utilisateur au lieu de simplement afficher l'erreur dans le formulaire.
    if (!acces || !verifierCode(codeActuel, acces.codeHache)) {
      res.status(403).json({ error: "Code actuel incorrect" });
      return;
    }

    await prisma.accesApplication.update({
      where: { id: acces.id },
      data: { identifiant: nouvelIdentifiant, codeHache: hacherCode(nouveauCode) },
    });

    res.json({ token: creerToken(nouvelIdentifiant) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier les identifiants" });
  }
});

export default router;
