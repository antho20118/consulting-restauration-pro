-- CreateEnum
CREATE TYPE "RoleUtilisateur" AS ENUM ('PROPRIETAIRE', 'CHEF', 'CUISINIER', 'CONSULTANT');

-- CreateTable
CREATE TABLE "Utilisateur" (
    "id" SERIAL NOT NULL,
    "identifiant" TEXT NOT NULL,
    "codeHache" TEXT NOT NULL,
    "role" "RoleUtilisateur" NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "societeId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Utilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Utilisateur_identifiant_key" ON "Utilisateur"("identifiant");

-- AddForeignKey
ALTER TABLE "Utilisateur" ADD CONSTRAINT "Utilisateur_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: traçabilité (qui a enregistré la production / validé le contrôle)
ALTER TABLE "Production" ADD COLUMN "creeParId" INTEGER;
ALTER TABLE "ControleHACCPProduction" ADD COLUMN "creeParId" INTEGER;

-- AddForeignKey (SET NULL : un compte désactivé plus tard ne doit jamais effacer une preuve déjà enregistrée)
ALTER TABLE "Production" ADD CONSTRAINT "Production_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ControleHACCPProduction" ADD CONSTRAINT "ControleHACCPProduction_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migration des données : l'unique identifiant/code partagé (AccesApplication) devient un compte
-- PROPRIETAIRE nominatif rattaché à la première société existante — cette table n'a jamais porté
-- de notion de société (un seul identifiant pour toute l'application), donc il n'existe pas de
-- meilleure correspondance que "la société la plus ancienne" pour une base déjà en production avec
-- plusieurs sociétés ; en pratique, à la date de cette migration, une seule société existe.
INSERT INTO "Utilisateur" ("identifiant", "codeHache", "role", "actif", "societeId", "updatedAt")
SELECT a."identifiant", a."codeHache", 'PROPRIETAIRE', true, s."id", CURRENT_TIMESTAMP
FROM "AccesApplication" a, LATERAL (SELECT "id" FROM "Societe" ORDER BY "id" ASC LIMIT 1) s
LIMIT 1;

-- DropTable
DROP TABLE "AccesApplication";
