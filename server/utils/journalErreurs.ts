import type { Request } from "express";
import prisma from "../prisma.js";

// Plafond volontairement bas (voir prisma/schema.prisma, JournalErreur) : ce journal sert un
// diagnostic à chaud (le dernier incident, pas un historique complet), pas un outil d'audit
// longue durée — inutile de faire grossir la base indéfiniment pour un usage mono-restaurant.
const PLAFOND = 500;

type ContexteErreur = {
  methode?: string;
  route?: string;
  statutHttp?: number;
  societeId?: number | null;
  utilisateurId?: number | null;
  userAgent?: string | null;
};

// Ne doit jamais faire échouer l'appelant : une erreur déjà en cours de traitement (le vrai
// problème à signaler) ne doit jamais être masquée par un second échec dans le journal lui-même
// (base indisponible, etc.) — ce journal est un complément à console.error, jamais son remplaçant.
export async function journaliserErreur(
  error: unknown,
  origine: "SERVEUR" | "CLIENT",
  contexte: ContexteErreur = {}
): Promise<void> {
  try {
    await prisma.journalErreur.create({
      data: {
        origine,
        methode: contexte.methode ?? null,
        route: contexte.route ?? null,
        statutHttp: contexte.statutHttp ?? null,
        message: error instanceof Error ? error.message : String(error),
        pile: error instanceof Error ? (error.stack ?? null) : null,
        societeId: contexte.societeId ?? null,
        utilisateurId: contexte.utilisateurId ?? null,
        userAgent: contexte.userAgent ?? null,
      },
    });
    await purgerSiNecessaire();
  } catch {
    // Silencieux volontairement (voir commentaire ci-dessus).
  }
}

async function purgerSiNecessaire(): Promise<void> {
  const total = await prisma.journalErreur.count();
  if (total <= PLAFOND) return;

  const aSupprimer = await prisma.journalErreur.findMany({
    orderBy: { moment: "asc" },
    take: total - PLAFOND,
    select: { id: true },
  });
  await prisma.journalErreur.deleteMany({ where: { id: { in: aSupprimer.map((e) => e.id) } } });
}

// Contexte commun (route, société, utilisateur) déduit d'une requête Express — pour appeler
// journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, res.statusCode)) d'un seul geste
// dans chaque catch de routeur, sans reconstruire ce mapping à chaque fois.
export function contexteDepuisRequete(req: Request, statutHttp?: number): ContexteErreur {
  return {
    methode: req.method,
    route: req.originalUrl,
    statutHttp,
    societeId: req.utilisateur?.societeId ?? null,
    utilisateurId: req.utilisateur?.id ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  };
}
