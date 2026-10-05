-- AlterTable
ALTER TABLE "MouvementStock" ADD COLUMN     "productionId" INTEGER;

-- CreateIndex
CREATE INDEX "MouvementStock_productionId_idx" ON "MouvementStock"("productionId");

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE SET NULL ON UPDATE CASCADE;
