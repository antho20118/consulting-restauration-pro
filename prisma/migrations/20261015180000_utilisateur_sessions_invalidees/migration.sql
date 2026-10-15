-- Date avant laquelle toute connexion (jeton) du compte est refusée (voir requireAuth.ts).
ALTER TABLE "Utilisateur" ADD COLUMN "sessionsInvalideesLe" TIMESTAMP(3);
