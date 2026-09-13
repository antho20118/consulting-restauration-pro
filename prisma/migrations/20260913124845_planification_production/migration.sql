-- AlterTable
ALTER TABLE "Recette" ADD COLUMN     "poidsAccompagnementG" DOUBLE PRECISION,
ADD COLUMN     "poidsPortionG" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "RecetteLigne" ADD COLUMN     "gainCuissonPct" DOUBLE PRECISION NOT NULL DEFAULT 0;
