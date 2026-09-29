import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";

import { racineStockage } from "../utils/storageDocumentsFournisseur.js";

const router = Router();

// Nom généré exclusivement par prisma/sauvegarder.ts (horodatage ISO assaini, ex.
// "sauvegarde-2026-06-15T10-30-00-000Z.json" — le "Z" final de toISOString() n'est jamais retiré,
// seuls ":" et "." sont remplacés par "-") : tout nom qui ne correspond pas à ce format exact est
// refusé avant même de toucher le système de fichiers — aucun ".." ni séparateur de chemin ne peut
// donc jamais atteindre ce contrôle.
const NOM_FICHIER_REGEX = /^sauvegarde-[0-9TZ-]+\.json$/;

function dossierSauvegardes(): string {
  return path.join(racineStockage(), "sauvegardes");
}

// Montée sous /api (voir server/app.ts) : hérite de requireAuth comme le reste de l'API — jamais
// d'accès aux sauvegardes de la base sans jeton valide.
router.get("/", async (_req, res) => {
  try {
    const dossier = dossierSauvegardes();
    let entrees: string[];
    try {
      entrees = await fs.readdir(dossier);
    } catch (erreur) {
      if ((erreur as NodeJS.ErrnoException).code === "ENOENT") {
        res.json([]);
        return;
      }
      throw erreur;
    }

    const fichiers = await Promise.all(
      entrees
        .filter((nom) => NOM_FICHIER_REGEX.test(nom))
        .map(async (nom) => {
          const stat = await fs.stat(path.join(dossier, nom));
          return { nom, tailleOctets: stat.size, creeLe: stat.mtime.toISOString() };
        })
    );

    fichiers.sort((a, b) => b.creeLe.localeCompare(a.creeLe));
    res.json(fichiers);
  } catch (erreur) {
    console.error(erreur);
    res.status(500).json({ error: "Impossible de lister les sauvegardes" });
  }
});

router.get("/:nomFichier", async (req, res) => {
  const { nomFichier } = req.params;
  if (!NOM_FICHIER_REGEX.test(nomFichier)) {
    res.status(400).json({ error: "Nom de sauvegarde invalide" });
    return;
  }

  try {
    const chemin = path.join(dossierSauvegardes(), nomFichier);
    const contenu = await fs.readFile(chemin);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(contenu);
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "Sauvegarde introuvable" });
      return;
    }
    console.error(erreur);
    res.status(500).json({ error: "Impossible de récupérer la sauvegarde" });
  }
});

export default router;
