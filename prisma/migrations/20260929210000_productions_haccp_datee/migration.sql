-- CreateTable
CREATE TABLE "Production" (
    "id" SERIAL NOT NULL,
    "recetteId" INTEGER NOT NULL,
    "societeId" INTEGER NOT NULL,
    "depotId" INTEGER,
    "dateProduction" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "portionsProduites" DOUBLE PRECISION NOT NULL,
    "poidsFiniProduitG" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Production_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControleHACCPProduction" (
    "id" SERIAL NOT NULL,
    "productionId" INTEGER NOT NULL,
    "recetteEtapeId" INTEGER NOT NULL,
    "dateHeure" TIMESTAMP(3) NOT NULL,
    "valeur" TEXT NOT NULL,
    "conforme" BOOLEAN NOT NULL,
    "commentaire" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControleHACCPProduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Production_recetteId_idx" ON "Production"("recetteId");

-- CreateIndex
CREATE INDEX "Production_dateProduction_idx" ON "Production"("dateProduction");

-- CreateIndex
CREATE INDEX "ControleHACCPProduction_productionId_idx" ON "ControleHACCPProduction"("productionId");

-- CreateIndex
CREATE INDEX "ControleHACCPProduction_recetteEtapeId_idx" ON "ControleHACCPProduction"("recetteEtapeId");

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_recetteId_fkey" FOREIGN KEY ("recetteId") REFERENCES "Recette"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControleHACCPProduction" ADD CONSTRAINT "ControleHACCPProduction_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControleHACCPProduction" ADD CONSTRAINT "ControleHACCPProduction_recetteEtapeId_fkey" FOREIGN KEY ("recetteEtapeId") REFERENCES "RecetteEtape"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
