import { Router } from "express";
import type { Request, Response } from "express";

import prisma from "../prisma.js";

const router = Router();

// Une société par compte connecté (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma) :
// toujours celle de l'identité authentifiée, jamais "la première" — chaque société ne voit et ne
// modifie jamais que ses propres paramètres.
router.get("/", async (req: Request, res: Response) => {
  try {
    const societe = await prisma.societe.findUnique({ where: { id: req.utilisateur!.societeId } });
    res.json(societe);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les informations de la société" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    // Scopé par société : jamais permettre de modifier les paramètres d'une AUTRE société en
    // devinant/énumérant simplement un id, même pour un PROPRIETAIRE (voir la matrice de
    // permissions, server/app.ts — le rôle seul ne suffit pas).
    if (id !== req.utilisateur!.societeId) {
      res.status(404).json({ error: "Société introuvable" });
      return;
    }

    const { nom, coefficientMultiplicateur } = req.body as {
      nom: string;
      coefficientMultiplicateur?: number | null;
    };

    // Nullable, jamais de valeur par défaut : tant que ce champ n'est pas explicitement saisi (ou
    // explicitement effacé, en renvoyant null), l'agent Consulting ne doit simuler aucun prix de
    // vente ni food cost théorique — voir server/routes/consulting.ts.
    if (
      coefficientMultiplicateur != null &&
      (!Number.isFinite(coefficientMultiplicateur) || coefficientMultiplicateur <= 0)
    ) {
      res.status(400).json({ error: "Coefficient multiplicateur invalide" });
      return;
    }

    // Trois états distincts à ne jamais confondre : champ absent du corps de requête (un appelant
    // qui ne connaît pas ce champ, ex. un ancien client) doit laisser la valeur déjà en base
    // intacte ; coefficientMultiplicateur: null doit explicitement la désactiver ; une valeur
    // numérique doit la remplacer. `?? null` confondait auparavant absent et null : un simple
    // PUT { nom } effaçait silencieusement un coefficient déjà configuré.
    const donnees: { nom: string; coefficientMultiplicateur?: number | null } = { nom };
    if ("coefficientMultiplicateur" in req.body) {
      donnees.coefficientMultiplicateur = coefficientMultiplicateur;
    }

    const societe = await prisma.societe.update({ where: { id }, data: donnees });

    res.json(societe);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de modifier la société" });
  }
});

export default router;
