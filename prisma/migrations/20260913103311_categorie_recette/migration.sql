-- DropForeignKey
ALTER TABLE "Recette" DROP CONSTRAINT "Recette_categorieId_fkey";

-- Les catégories de recettes existantes pointaient vers la table des catégories d'ingrédients
-- (Épicerie, Frais…), qui n'a jamais eu de sens pour une recette (c'était le bug corrigé par cette
-- migration) : on les remet à vide plutôt que de les faire pointer par erreur sur un nouvel id de
-- CategorieRecette qui n'a aucun rapport.
UPDATE "Recette" SET "categorieId" = NULL WHERE "categorieId" IS NOT NULL;

-- CreateTable
CREATE TABLE "CategorieRecette" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategorieRecette_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategorieRecette_nom_key" ON "CategorieRecette"("nom");

-- AddForeignKey
ALTER TABLE "Recette" ADD CONSTRAINT "Recette_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "CategorieRecette"("id") ON DELETE SET NULL ON UPDATE CASCADE;
