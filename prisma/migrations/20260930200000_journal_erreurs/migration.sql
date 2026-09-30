-- CreateEnum
CREATE TYPE "OrigineErreur" AS ENUM ('SERVEUR', 'CLIENT');

-- CreateTable
CREATE TABLE "JournalErreur" (
    "id" SERIAL NOT NULL,
    "origine" "OrigineErreur" NOT NULL,
    "moment" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "methode" TEXT,
    "route" TEXT,
    "statutHttp" INTEGER,
    "message" TEXT NOT NULL,
    "pile" TEXT,
    "userAgent" TEXT,
    "societeId" INTEGER,
    "utilisateurId" INTEGER,

    CONSTRAINT "JournalErreur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JournalErreur_moment_idx" ON "JournalErreur"("moment");

-- CreateIndex
CREATE INDEX "JournalErreur_societeId_idx" ON "JournalErreur"("societeId");
