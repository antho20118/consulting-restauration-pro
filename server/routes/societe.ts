import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// Structure du corps de PUT (F09/F10) : un corps absent ou non objet, ou un nom d'un mauvais type,
// faisaient planter la route en 500 ; un nom vide ou blanc était enregistré tel quel. `nom` reste
// facultatif (absent = inchangé) et n'est jamais retaillé : seule une valeur vide est refusée.
// coefficientMultiplicateur garde son contrôle dédié ci-dessous (message et trois états inchangés).
const schemaModificationSociete = z
  .object({
    nom: z
      .string()
      .refine((nom) => nom.trim().length > 0, "Le nom de la société ne peut pas être vide")
      .optional(),
  })
  .passthrough();

// Une société par compte connecté (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma) :
// toujours celle de l'identité authentifiée, jamais "la première" — chaque société ne voit et ne
// modifie jamais que ses propres paramètres.
router.get("/", async (req: Request, res: Response) => {
  try {
    const societe = await prisma.societe.findUnique({ where: { id: req.utilisateur!.societeId } });
    res.json(societe);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
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

    const analyse = schemaModificationSociete.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Société invalide", details: analyse.error.flatten() });
      return;
    }
    const { nom } = analyse.data;
    const { coefficientMultiplicateur } = req.body as { coefficientMultiplicateur?: number | null };

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
    const donnees: { nom?: string; coefficientMultiplicateur?: number | null } = { nom };
    if ("coefficientMultiplicateur" in req.body) {
      donnees.coefficientMultiplicateur = coefficientMultiplicateur;
    }

    const societe = await prisma.societe.update({ where: { id }, data: donnees });

    res.json(societe);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de modifier la société" });
  }
});

export default router;
