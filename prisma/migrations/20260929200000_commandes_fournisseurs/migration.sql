-- CreateEnum
CREATE TYPE "StatutCommandeFournisseur" AS ENUM ('EN_ATTENTE', 'RECUE', 'RECUE_PARTIELLEMENT', 'ANNULEE');

-- CreateTable
CREATE TABLE "CommandeFournisseur" (
    "id" SERIAL NOT NULL,
    "fournisseurId" INTEGER NOT NULL,
    "depotId" INTEGER NOT NULL,
    "statut" "StatutCommandeFournisseur" NOT NULL DEFAULT 'EN_ATTENTE',
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateReception" TIMESTAMP(3),

    CONSTRAINT "CommandeFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneCommandeFournisseur" (
    "id" SERIAL NOT NULL,
    "commandeId" INTEGER NOT NULL,
    "articleId" INTEGER NOT NULL,
    "conditionnementLibelle" TEXT NOT NULL,
    "conditionnements" INTEGER NOT NULL,
    "quantiteCommandeeBase" DOUBLE PRECISION NOT NULL,
    "quantiteRecueBase" DOUBLE PRECISION,
    "prixUnitaireBase" DOUBLE PRECISION NOT NULL,
    "mouvementStockId" INTEGER,

    CONSTRAINT "LigneCommandeFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommandeFournisseur_fournisseurId_idx" ON "CommandeFournisseur"("fournisseurId");

-- CreateIndex
CREATE INDEX "CommandeFournisseur_depotId_idx" ON "CommandeFournisseur"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "LigneCommandeFournisseur_mouvementStockId_key" ON "LigneCommandeFournisseur"("mouvementStockId");

-- CreateIndex
CREATE INDEX "LigneCommandeFournisseur_commandeId_idx" ON "LigneCommandeFournisseur"("commandeId");

-- CreateIndex
CREATE INDEX "LigneCommandeFournisseur_articleId_idx" ON "LigneCommandeFournisseur"("articleId");

-- AddForeignKey
ALTER TABLE "CommandeFournisseur" ADD CONSTRAINT "CommandeFournisseur_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeFournisseur" ADD CONSTRAINT "CommandeFournisseur_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneCommandeFournisseur" ADD CONSTRAINT "LigneCommandeFournisseur_commandeId_fkey" FOREIGN KEY ("commandeId") REFERENCES "CommandeFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneCommandeFournisseur" ADD CONSTRAINT "LigneCommandeFournisseur_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneCommandeFournisseur" ADD CONSTRAINT "LigneCommandeFournisseur_mouvementStockId_fkey" FOREIGN KEY ("mouvementStockId") REFERENCES "MouvementStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
