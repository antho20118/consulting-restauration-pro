-- CreateEnum
CREATE TYPE "MotifCorrespondanceVente" AS ENUM ('ALIAS', 'DESIGNATION_EXACTE', 'DESIGNATION_APPROXIMATIVE');

-- CreateEnum
CREATE TYPE "DecisionLigneVente" AS ENUM ('EN_ATTENTE', 'VALIDEE', 'REJETEE');

-- CreateTable
CREATE TABLE "AliasProduitVenduImport" (
    "id" SERIAL NOT NULL,
    "texteNormalise" TEXT NOT NULL,
    "recetteId" INTEGER NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AliasProduitVenduImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVentes" (
    "id" SERIAL NOT NULL,
    "societeId" INTEGER NOT NULL,
    "periodeDebut" TIMESTAMP(3),
    "periodeFin" TIMESTAMP(3),
    "nomFichierOriginal" TEXT,
    "importeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeParId" INTEGER,

    CONSTRAINT "DocumentVentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneVente" (
    "id" SERIAL NOT NULL,
    "documentVentesId" INTEGER NOT NULL,
    "designationLue" TEXT NOT NULL,
    "quantiteVendue" DOUBLE PRECISION NOT NULL,
    "prixVenteUnitaireLu" DOUBLE PRECISION,
    "recetteProposeeId" INTEGER,
    "confiance" DOUBLE PRECISION,
    "motifCorrespondance" "MotifCorrespondanceVente",
    "candidatsAlternatifs" JSONB,
    "decision" "DecisionLigneVente" NOT NULL DEFAULT 'EN_ATTENTE',
    "recetteRetenueId" INTEGER,

    CONSTRAINT "LigneVente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AliasProduitVenduImport_texteNormalise_key" ON "AliasProduitVenduImport"("texteNormalise");

-- CreateIndex
CREATE INDEX "AliasProduitVenduImport_recetteId_idx" ON "AliasProduitVenduImport"("recetteId");

-- CreateIndex
CREATE INDEX "DocumentVentes_societeId_idx" ON "DocumentVentes"("societeId");

-- CreateIndex
CREATE INDEX "LigneVente_documentVentesId_idx" ON "LigneVente"("documentVentesId");

-- CreateIndex
CREATE INDEX "LigneVente_recetteRetenueId_idx" ON "LigneVente"("recetteRetenueId");

-- AddForeignKey
ALTER TABLE "AliasProduitVenduImport" ADD CONSTRAINT "AliasProduitVenduImport_recetteId_fkey" FOREIGN KEY ("recetteId") REFERENCES "Recette"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVentes" ADD CONSTRAINT "DocumentVentes_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (SET NULL : un compte désactivé plus tard ne doit jamais effacer un historique d'import déjà enregistré)
ALTER TABLE "DocumentVentes" ADD CONSTRAINT "DocumentVentes_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_documentVentesId_fkey" FOREIGN KEY ("documentVentesId") REFERENCES "DocumentVentes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_recetteProposeeId_fkey" FOREIGN KEY ("recetteProposeeId") REFERENCES "Recette"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_recetteRetenueId_fkey" FOREIGN KEY ("recetteRetenueId") REFERENCES "Recette"("id") ON DELETE SET NULL ON UPDATE CASCADE;
