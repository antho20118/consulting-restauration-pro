-- CreateTable
CREATE TABLE "AccesApplication" (
    "id" SERIAL NOT NULL,
    "identifiant" TEXT NOT NULL,
    "codeHache" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccesApplication_pkey" PRIMARY KEY ("id")
);

-- Identifiant/code par défaut : admin / 1234 (hash bcrypt précalculé). Insérée directement ici
-- plutôt que dans prisma/seed.ts pour qu'elle arrive automatiquement via `prisma migrate deploy`,
-- déjà exécuté au démarrage en production — inutile de rejouer un seed manuellement à déployer.
-- À changer depuis Paramètres après la première connexion.
INSERT INTO "AccesApplication" ("identifiant", "codeHache", "updatedAt")
SELECT 'admin', '$2b$10$tntFBl2Rcl2fjLH2V7XwzOcMyWVY8jVQxG3xm63lkDKZ/aMUO0Y/G', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "AccesApplication");
