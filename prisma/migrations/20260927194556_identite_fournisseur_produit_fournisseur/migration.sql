
-- AlterTable
ALTER TABLE "Fournisseur" ADD COLUMN     "codeFournisseur" TEXT;

-- AlterTable
ALTER TABLE "TarifArticle" ADD COLUMN     "produitFournisseurId" INTEGER;

-- CreateTable
CREATE TABLE "SocieteCompteur" (
    "id" SERIAL NOT NULL,
    "societeId" INTEGER NOT NULL,
    "typeCompteur" TEXT NOT NULL,
    "valeur" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SocieteCompteur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProduitFournisseur" (
    "id" SERIAL NOT NULL,
    "fournisseurId" INTEGER NOT NULL,
    "codeProduitFournisseur" TEXT NOT NULL,
    "articleId" INTEGER NOT NULL,
    "designationConnue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProduitFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocieteCompteur_societeId_typeCompteur_key" ON "SocieteCompteur"("societeId", "typeCompteur");

-- CreateIndex
CREATE INDEX "ProduitFournisseur_articleId_idx" ON "ProduitFournisseur"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "ProduitFournisseur_fournisseurId_codeProduitFournisseur_key" ON "ProduitFournisseur"("fournisseurId", "codeProduitFournisseur");

-- CreateIndex
CREATE UNIQUE INDEX "Fournisseur_societeId_codeFournisseur_key" ON "Fournisseur"("societeId", "codeFournisseur");

-- CreateIndex
CREATE INDEX "TarifArticle_produitFournisseurId_idx" ON "TarifArticle"("produitFournisseurId");

-- AddForeignKey
ALTER TABLE "TarifArticle" ADD CONSTRAINT "TarifArticle_produitFournisseurId_fkey" FOREIGN KEY ("produitFournisseurId") REFERENCES "ProduitFournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProduitFournisseur" ADD CONSTRAINT "ProduitFournisseur_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProduitFournisseur" ADD CONSTRAINT "ProduitFournisseur_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
