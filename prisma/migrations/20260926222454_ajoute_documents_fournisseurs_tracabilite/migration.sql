-- CreateEnum
CREATE TYPE "TypeImportTarifs" AS ENUM ('LISTING', 'FACTURE');

-- CreateEnum
CREATE TYPE "StatutDocumentFournisseur" AS ENUM ('EN_ATTENTE', 'VALIDE', 'IGNORE');

-- CreateEnum
CREATE TYPE "NatureLigneFournisseur" AS ENUM ('ARTICLE', 'FRAIS_LIVRAISON', 'AVOIR', 'NON_ALIMENTAIRE', 'REMISE');

-- CreateEnum
CREATE TYPE "MotifCorrespondance" AS ENUM ('REFERENCE_FOURNISSEUR', 'CODE_ARTICLE', 'ALIAS', 'DESIGNATION_EXACTE', 'DESIGNATION_APPROXIMATIVE');

-- CreateEnum
CREATE TYPE "DecisionLigneFournisseur" AS ENUM ('EN_ATTENTE', 'VALIDEE', 'REJETEE');

-- CreateTable
CREATE TABLE "DocumentFournisseur" (
    "id" SERIAL NOT NULL,
    "fournisseurId" INTEGER NOT NULL,
    "type" "TypeImportTarifs" NOT NULL,
    "statut" "StatutDocumentFournisseur" NOT NULL DEFAULT 'EN_ATTENTE',
    "cle" TEXT NOT NULL,
    "typeMime" TEXT NOT NULL,
    "tailleOctets" INTEGER NOT NULL,
    "nomFichierOriginal" TEXT,
    "numero" TEXT,
    "dateDocument" TIMESTAMP(3),
    "montantTotal" DOUBLE PRECISION,
    "importeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneDocumentFournisseur" (
    "id" SERIAL NOT NULL,
    "documentId" INTEGER NOT NULL,
    "designationLue" TEXT NOT NULL,
    "referenceLue" TEXT,
    "quantiteLue" DOUBLE PRECISION,
    "uniteLue" TEXT,
    "conditionnementLu" TEXT,
    "prixLu" DOUBLE PRECISION,
    "natureLigne" "NatureLigneFournisseur" NOT NULL DEFAULT 'ARTICLE',
    "articleProposeId" INTEGER,
    "confiance" DOUBLE PRECISION,
    "motifCorrespondance" "MotifCorrespondance",
    "candidatsAlternatifs" JSONB,
    "decision" "DecisionLigneFournisseur" NOT NULL DEFAULT 'EN_ATTENTE',
    "articleRetenuId" INTEGER,
    "tarifCreeId" INTEGER,

    CONSTRAINT "LigneDocumentFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFournisseur_cle_key" ON "DocumentFournisseur"("cle");

-- CreateIndex
CREATE INDEX "DocumentFournisseur_fournisseurId_idx" ON "DocumentFournisseur"("fournisseurId");

-- CreateIndex
CREATE UNIQUE INDEX "LigneDocumentFournisseur_tarifCreeId_key" ON "LigneDocumentFournisseur"("tarifCreeId");

-- CreateIndex
CREATE INDEX "LigneDocumentFournisseur_documentId_idx" ON "LigneDocumentFournisseur"("documentId");

-- CreateIndex
CREATE INDEX "LigneDocumentFournisseur_articleProposeId_idx" ON "LigneDocumentFournisseur"("articleProposeId");

-- CreateIndex
CREATE INDEX "LigneDocumentFournisseur_articleRetenuId_idx" ON "LigneDocumentFournisseur"("articleRetenuId");

-- AddForeignKey
ALTER TABLE "DocumentFournisseur" ADD CONSTRAINT "DocumentFournisseur_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDocumentFournisseur" ADD CONSTRAINT "LigneDocumentFournisseur_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDocumentFournisseur" ADD CONSTRAINT "LigneDocumentFournisseur_articleProposeId_fkey" FOREIGN KEY ("articleProposeId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDocumentFournisseur" ADD CONSTRAINT "LigneDocumentFournisseur_articleRetenuId_fkey" FOREIGN KEY ("articleRetenuId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDocumentFournisseur" ADD CONSTRAINT "LigneDocumentFournisseur_tarifCreeId_fkey" FOREIGN KEY ("tarifCreeId") REFERENCES "TarifArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
