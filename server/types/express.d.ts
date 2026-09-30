// Peuplé par requireAuth.ts à partir du jeton — jamais par une route elle-même, pour qu'aucune
// route ne puisse se faire passer pour un autre utilisateur/une autre société. Type dupliqué (pas
// importé) depuis PayloadUtilisateur (server/utils/auth.ts) : un fichier de déclaration globale
// avec import/export devient un module, et "declare global" n'y augmente plus systématiquement
// Express.Request selon la configuration du projet (tsc -b multi-projets ici) — rester purement
// ambiant est la façon fiable d'augmenter un type d'une librairie tierce.
declare global {
  namespace Express {
    interface Request {
      utilisateur?: {
        id: number;
        identifiant: string;
        role: "PROPRIETAIRE" | "CHEF" | "CUISINIER" | "CONSULTANT";
        societeId: number;
      };
    }
  }
}

export {};
