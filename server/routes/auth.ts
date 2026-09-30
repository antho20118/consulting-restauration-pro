import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { creerToken, hacherCode, verifierCode } from "../utils/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

const schemaLogin = z.object({
  identifiant: z.string().trim().min(1).max(100),
  code: z.string().min(1).max(200),
});
const schemaChangementCompte = z.object({
  codeActuel: z.string().min(1).max(200),
  nouvelIdentifiant: z.string().trim().min(1).max(100),
  nouveauCode: z.string().min(6).max(200),
});

// Limitation simple des tentatives de connexion par IP : un compte nominatif reste une cible
// d'essai automatisé exhaustif comme avant. Volontairement en mémoire (pas de dépendance ajoutée) :
// suffisant pour une seule instance de serveur, se réinitialise à un redémarrage.
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

// Connexion : un compte nominatif par personne (voir Utilisateur, prisma/schema.prisma), remplace
// l'ancien identifiant/code partagé — un compte désactivé (départ, changement de poste) ne peut
// plus se connecter, sans devoir changer le code pour toute l'équipe.
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

    const utilisateur = await prisma.utilisateur.findUnique({ where: { identifiant } });

    // Même message d'erreur qu'un compte inexistant, désactivé ou un mauvais code : jamais
    // distinguer "ce compte existe mais est désactivé" à quelqu'un qui ne s'est pas authentifié.
    if (!utilisateur || !utilisateur.actif || !verifierCode(code, utilisateur.codeHache)) {
      res.status(401).json({ error: "Identifiant ou code incorrect" });
      return;
    }

    const token = creerToken({
      id: utilisateur.id,
      identifiant: utilisateur.identifiant,
      role: utilisateur.role,
      societeId: utilisateur.societeId,
    });
    res.json({
      token,
      utilisateur: {
        id: utilisateur.id,
        identifiant: utilisateur.identifiant,
        role: utilisateur.role,
        societeId: utilisateur.societeId,
      },
    });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de se connecter" });
  }
});

// Modification de SES PROPRES identifiants (identifiant + code) — jamais ceux d'un autre compte :
// voir server/routes/utilisateurs.ts pour la gestion des comptes par un PROPRIETAIRE.
router.put("/moi", requireAuth, async (req: Request, res: Response) => {
  try {
    const analyse = schemaChangementCompte.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Tous les champs sont requis (le nouveau code doit faire au moins 6 caractères)" });
      return;
    }
    const { codeActuel, nouvelIdentifiant, nouveauCode } = analyse.data;

    const utilisateur = await prisma.utilisateur.findUniqueOrThrow({ where: { id: req.utilisateur!.id } });

    // 403 (et non 401) : la session est valide (on a passé requireAuth), seul le code actuel
    // saisi est refusé. Un 401 ici serait intercepté par apiFetch comme une session expirée et
    // déconnecterait l'utilisateur au lieu de simplement afficher l'erreur dans le formulaire.
    if (!verifierCode(codeActuel, utilisateur.codeHache)) {
      res.status(403).json({ error: "Code actuel incorrect" });
      return;
    }

    if (nouvelIdentifiant !== utilisateur.identifiant) {
      const doublon = await prisma.utilisateur.findUnique({ where: { identifiant: nouvelIdentifiant } });
      if (doublon) {
        res.status(409).json({ error: "Cet identifiant est déjà utilisé par un autre compte" });
        return;
      }
    }

    const misAJour = await prisma.utilisateur.update({
      where: { id: utilisateur.id },
      data: { identifiant: nouvelIdentifiant, codeHache: hacherCode(nouveauCode) },
    });

    const token = creerToken({
      id: misAJour.id,
      identifiant: misAJour.identifiant,
      role: misAJour.role,
      societeId: misAJour.societeId,
    });
    res.json({ token });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de modifier le compte" });
  }
});

export default router;
