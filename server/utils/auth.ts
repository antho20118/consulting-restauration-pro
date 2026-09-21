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

export function creerToken(identifiant: string): string {
  return jwt.sign({ identifiant }, SECRET_EFFECTIF, { expiresIn: DUREE_TOKEN });
}

export function verifierToken(token: string): boolean {
  try {
    jwt.verify(token, SECRET_EFFECTIF);
    return true;
  } catch {
    return false;
  }
}
