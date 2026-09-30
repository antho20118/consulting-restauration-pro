import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import { verifierToken } from "../utils/auth.js";
import { journaliserErreur } from "../utils/journalErreurs.js";

const router = Router();

const schemaErreurClient = z.object({
  message: z.string().min(1).max(2000),
  pile: z.string().max(8000).optional(),
  route: z.string().max(500).optional(),
});

// Limitation simple par IP (même principe que server/routes/auth.ts) : ce point d'entrée est
// volontairement monté avant requireAuth (voir app.ts) — la cause la plus probable d'un rapport
// ici est justement un jeton invalide/expiré (voir server/middleware/requireAuth.ts), donc exiger
// un jeton valide pour signaler qu'il ne l'est pas serait absurde — mais ça en fait une cible
// d'abus pour remplir le journal si on ne la limite pas.
const compteurParIp = new Map<string, { compte: number; expire: number }>();
const FENETRE_MS = 15 * 60_000;
const MAX_PAR_FENETRE = 30;

function autoriseEnvoi(ip: string): boolean {
  const maintenant = Date.now();
  const entree = compteurParIp.get(ip);
  if (!entree || entree.expire <= maintenant) {
    compteurParIp.set(ip, { compte: 1, expire: maintenant + FENETRE_MS });
    return true;
  }
  if (entree.compte >= MAX_PAR_FENETRE) return false;
  entree.compte += 1;
  return true;
}

router.post("/", async (req: Request, res: Response) => {
  if (!autoriseEnvoi(req.ip ?? "inconnu")) {
    res.status(429).end();
    return;
  }

  const analyse = schemaErreurClient.safeParse(req.body);
  if (!analyse.success) {
    res.status(400).end();
    return;
  }

  // Décodage du jeton volontairement best-effort (jamais de 401 ici, voir commentaire ci-dessus) :
  // sert uniquement à rattacher l'entrée à une société/un utilisateur quand c'est possible, jamais
  // une condition pour accepter le rapport.
  const entete = req.headers.authorization;
  const token = entete?.startsWith("Bearer ") ? entete.slice(7) : null;
  const payload = token ? verifierToken(token) : null;

  const erreur = new Error(analyse.data.message);
  if (analyse.data.pile) erreur.stack = analyse.data.pile;

  await journaliserErreur(erreur, "CLIENT", {
    route: analyse.data.route,
    societeId: payload?.societeId ?? null,
    utilisateurId: typeof payload?.id === "number" ? payload.id : null,
    userAgent: req.headers["user-agent"],
  });

  res.status(204).end();
});

export default router;
