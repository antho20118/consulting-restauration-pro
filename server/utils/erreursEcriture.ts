import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { journaliserErreur, contexteDepuisRequete } from "./journalErreurs.js";

// Levée quand un nom de fournisseur (saisi librement — création manuelle d'article ou import de
// listing) correspond, après normalisation, à PLUSIEURS fournisseurs déjà existants : jamais un
// choix arbitraire (voir chantier « identité fournisseur + historique des imports »). L'appelant
// interrompt l'écriture en cours ; cette classe centralise la réponse HTTP explicite renvoyée.
export class FournisseurAmbiguError extends Error {
  constructor(
    public readonly nomFournisseur: string,
    public readonly fournisseurIds: number[]
  ) {
    super(`Plusieurs fournisseurs existants correspondent au nom "${nomFournisseur}"`);
    this.name = "FournisseurAmbiguError";
  }
}

// Levée quand un fournisseur retrouvé (par code ou par nom) est actif:false — voir cadrage
// « identité fournisseur + produit fournisseur + historique des tarifs », §8/§9 : jamais réutilisé
// silencieusement, jamais réactivé automatiquement, jamais un nouveau fournisseur créé avec le même
// identifiant. L'appelant doit bloquer explicitement et orienter vers POST /fournisseurs/:id/reactiver.
export class FournisseurInactifError extends Error {
  constructor(
    public readonly identifiant: string,
    public readonly fournisseurId: number
  ) {
    super(`Le fournisseur "${identifiant}" existe mais est inactif`);
    this.name = "FournisseurInactifError";
  }
}

// Levée quand un codeFournisseur fourni par l'import ne correspond à aucun fournisseur existant —
// jamais de création silencieuse à partir d'un code (voir cadrage §6, niveau 3) : contrairement à
// une résolution par nom, un code inconnu n'a pas de signification suffisante pour créer un
// nouveau fournisseur (il pourrait s'agir d'une faute de frappe sur un code existant).
export class FournisseurCodeInconnuError extends Error {
  constructor(public readonly code: string) {
    super(`Aucun fournisseur ne correspond au code "${code}"`);
    this.name = "FournisseurCodeInconnuError";
  }
}

// Point unique de traduction des erreurs d'écriture Prisma en réponse HTTP (voir caractérisation
// dédiée « FK 500→400, portée transversale ») : une violation de contrainte de clé étrangère
// (code Prisma P2003) signifie qu'un champ référence un enregistrement inexistant (ou plus) — une
// erreur prévisible côté appelant, jamais une panne serveur, qui doit donc être renvoyée en 400,
// pas en 500. Le champ précis en cause n'est volontairement pas identifié dans le message : Prisma
// n'expose pas toujours cette information de façon exploitable selon le moteur de base de données,
// et un message générique reste correct dans tous les cas plutôt que risquer d'en afficher un faux.
// Toute autre erreur (bug, panne DB, contrainte métier volontairement levée ailleurs — ex.
// portions <= 0 dans coutRecette.ts, déjà classé comme comportement correct et volontairement
// laissé en 500 par les chantiers précédents) continue de renvoyer le message générique existant,
// strictement inchangé.
export async function repondreErreurEcriture(
  error: unknown,
  res: Response,
  messageParDefaut: string,
  req?: Request
): Promise<void> {
  if (error instanceof FournisseurAmbiguError) {
    res.status(409).json({
      error:
        `Plusieurs fournisseurs existants correspondent au nom "${error.nomFournisseur}" : ` +
        "impossible de déterminer lequel utiliser sans choix arbitraire. Résous cette ambiguïté " +
        "(fiches fournisseurs) avant de continuer.",
      fournisseurIds: error.fournisseurIds,
    });
    return;
  }

  if (error instanceof FournisseurInactifError) {
    res.status(409).json({
      error:
        `Le fournisseur "${error.identifiant}" existe mais est actuellement inactif : ` +
        "réactive-le explicitement (fiche fournisseur) avant de réimporter, ou choisis un autre fournisseur.",
      fournisseurId: error.fournisseurId,
    });
    return;
  }

  if (error instanceof FournisseurCodeInconnuError) {
    res.status(409).json({
      error: `Aucun fournisseur ne correspond au code "${error.code}" : aucune création silencieuse à partir d'un code inconnu.`,
      code: error.code,
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    res.status(400).json({ error: "Référence invalide : un champ désigne un enregistrement inexistant" });
    return;
  }

  console.error(error);
  // Seul ce dernier recours (une erreur imprévue, jamais un des cas métier ci-dessus déjà attendus
  // et délibérément non journalisés) est écrit dans le journal — voir server/utils/journalErreurs.ts.
  if (req) await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
  res.status(500).json({ error: messageParDefaut });
}
