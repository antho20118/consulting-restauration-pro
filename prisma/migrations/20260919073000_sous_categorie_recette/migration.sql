-- CreateTable
CREATE TABLE "SousCategorieRecette" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SousCategorieRecette_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SousCategorieRecette_nom_key" ON "SousCategorieRecette"("nom");

-- AlterTable
ALTER TABLE "Recette" ADD COLUMN "sousCategorieId" INTEGER;

-- AddForeignKey
ALTER TABLE "Recette" ADD CONSTRAINT "Recette_sousCategorieId_fkey" FOREIGN KEY ("sousCategorieId") REFERENCES "SousCategorieRecette"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sous-catégories de référence (type d'ingrédient principal). ON CONFLICT ... DO NOTHING rend
-- l'insertion sans risque si les lignes existent déjà.
INSERT INTO "SousCategorieRecette" ("nom", "updatedAt")
VALUES
  ('Viande', CURRENT_TIMESTAMP),
  ('Volaille', CURRENT_TIMESTAMP),
  ('Poisson', CURRENT_TIMESTAMP),
  ('Légumes', CURRENT_TIMESTAMP),
  ('Pâtes', CURRENT_TIMESTAMP),
  ('Riz', CURRENT_TIMESTAMP),
  ('Pain', CURRENT_TIMESTAMP),
  ('Autre', CURRENT_TIMESTAMP)
ON CONFLICT ("nom") DO NOTHING;
