import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";
import { creerToken, hacherCode, verifierCode } from "../utils/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

// Connexion : un seul identifiant/code partagé pour toute l'équipe (pas de compte nominatif).
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { identifiant, code } = req.body as { identifiant?: string; code?: string };

    if (!identifiant || !code) {
      res.status(400).json({ error: "Identifiant et code requis" });
      return;
    }

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
    const { codeActuel, nouvelIdentifiant, nouveauCode } = req.body as {
      codeActuel?: string;
      nouvelIdentifiant?: string;
      nouveauCode?: string;
    };

    if (!codeActuel || !nouvelIdentifiant || !nouveauCode) {
      res.status(400).json({ error: "Tous les champs sont requis" });
      return;
    }

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
