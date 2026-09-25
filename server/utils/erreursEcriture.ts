import { Prisma } from "@prisma/client";
import type { Response } from "express";

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
export function repondreErreurEcriture(error: unknown, res: Response, messageParDefaut: string): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    res.status(400).json({ error: "Référence invalide : un champ désigne un enregistrement inexistant" });
    return;
  }

  console.error(error);
  res.status(500).json({ error: messageParDefaut });
}
