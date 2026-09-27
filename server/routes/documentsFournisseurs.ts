import { Router } from "express";

import { DocumentInvalideError, lireDocument } from "../utils/storageDocumentsFournisseur.js";

const router = Router();

// Montée sous /api (voir server/app.ts) : hérite de requireAuth comme le reste de l'API — jamais
// d'URL publique permettant d'accéder à un document sans jeton valide (voir cadrage Phase 1).
//
// Phase 1 seule : ne dépend d'aucun modèle Prisma (DocumentFournisseur arrive en Phase 2). Le
// fournisseurId est vérifié comme un entier positif, la clé comme un UUID strict, avant même
// d'atteindre le module de stockage — toute autre valeur est un 400, jamais une tentative de lecture
// disque.
router.get("/:fournisseurId/:cle", async (req, res) => {
  const fournisseurId = Number(req.params.fournisseurId);
  const { cle } = req.params;

  try {
    const document = await lireDocument(fournisseurId, cle);
    if (!document) {
      res.status(404).json({ error: "Document introuvable" });
      return;
    }

    res.setHeader("Content-Type", document.typeMime);
    // Jamais "attachment" forcé : un document doit pouvoir être prévisualisé (image/PDF) dans
    // l'interface de la facture, pas seulement téléchargé.
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(document.buffer);
  } catch (erreur) {
    if (erreur instanceof DocumentInvalideError) {
      res.status(400).json({ error: erreur.message });
      return;
    }
    console.error(erreur);
    res.status(500).json({ error: "Impossible de récupérer le document" });
  }
});

export default router;
