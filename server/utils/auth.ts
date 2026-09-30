import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// En production, un secret JWT absent ne doit jamais retomber silencieusement sur une valeur par
// défaut connue de tous (elle permettrait de forger des jetons valides) : le serveur refuse de
// démarrer plutôt que de servir une authentification qu'il ne protège pas réellement. En
// développement, une valeur locale fixe reste acceptée pour ne pas exiger de configuration.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "JWT_SECRET doit être défini en production (variable d'environnement manquante) : démarrage refusé."
  );
}
const SECRET_EFFECTIF = JWT_SECRET || "dev-secret-local-uniquement";
const DUREE_TOKEN = "12h";

export function hacherCode(code: string): string {
  return bcrypt.hashSync(code, 10);
}

export function verifierCode(code: string, hache: string): boolean {
  return bcrypt.compareSync(code, hache);
}

// Un compte par personne (voir Utilisateur, prisma/schema.prisma) : le jeton porte l'identité
// entière (id, rôle, société) pour que le reste du serveur n'ait plus jamais à faire confiance à
// un societeId envoyé par le client — voir requireAuth.ts, qui peuple req.utilisateur à partir de
// ce payload.
export type PayloadUtilisateur = {
  id: number;
  identifiant: string;
  role: "PROPRIETAIRE" | "CHEF" | "CUISINIER" | "CONSULTANT";
  societeId: number;
};

export function creerToken(payload: PayloadUtilisateur): string {
  return jwt.sign(payload, SECRET_EFFECTIF, { expiresIn: DUREE_TOKEN });
}

// null si le jeton est absent/invalide/expiré — jamais un simple booléen (voir requireAuth.ts, qui
// a besoin du payload décodé, pas seulement de savoir s'il est valide).
export function verifierToken(token: string): PayloadUtilisateur | null {
  try {
    return jwt.verify(token, SECRET_EFFECTIF) as PayloadUtilisateur;
  } catch {
    return null;
  }
}
