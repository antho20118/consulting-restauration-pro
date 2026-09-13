-- AlterTable
ALTER TABLE "Recette" ADD COLUMN     "photo" TEXT;

-- CreateTable
CREATE TABLE "RecetteEtape" (
    "id" SERIAL NOT NULL,
    "recetteId" INTEGER NOT NULL,
    "ordre" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "pointCritiqueHACCP" BOOLEAN NOT NULL DEFAULT false,
    "controleHACCP" TEXT,

    CONSTRAINT "RecetteEtape_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecetteEtape_recetteId_idx" ON "RecetteEtape"("recetteId");

-- AddForeignKey
ALTER TABLE "RecetteEtape" ADD CONSTRAINT "RecetteEtape_recetteId_fkey" FOREIGN KEY ("recetteId") REFERENCES "Recette"("id") ON DELETE CASCADE ON UPDATE CASCADE;
