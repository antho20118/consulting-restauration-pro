import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// À définir en production (variable d'environnement JWT_SECRET) : cette valeur par défaut ne
// protège pas contre la falsification de jetons si elle reste utilisée en production.
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-a-changer-en-production";
const DUREE_TOKEN = "12h";

export function hacherCode(code: string): string {
  return bcrypt.hashSync(code, 10);
}

export function verifierCode(code: string, hache: string): boolean {
  return bcrypt.compareSync(code, hache);
}

export function creerToken(identifiant: string): string {
  return jwt.sign({ identifiant }, JWT_SECRET, { expiresIn: DUREE_TOKEN });
}

export function verifierToken(token: string): boolean {
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}
