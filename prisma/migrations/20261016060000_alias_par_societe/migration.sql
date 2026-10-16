-- Correspondances apprises à l'import propres à chaque entreprise (point 10 de l'audit du 15/10) :
-- la clé unique devient (societeId, texteNormalise) au lieu du seul texte, partagé par toutes les
-- sociétés. La société de chaque correspondance existante est celle de l'article (ingrédients) ou
-- de la recette (produits vendus) qu'elle désigne : rien n'est perdu.

-- Ingrédients (texte -> article)
ALTER TABLE "AliasIngredientImport" ADD COLUMN "societeId" INTEGER;
UPDATE "AliasIngredientImport" AS a
SET "societeId" = ar."societeId"
FROM "Article" AS ar
WHERE ar."id" = a."articleId";
ALTER TABLE "AliasIngredientImport" ALTER COLUMN "societeId" SET NOT NULL;
DROP INDEX "AliasIngredientImport_texteNormalise_key";
CREATE UNIQUE INDEX "AliasIngredientImport_societeId_texteNormalise_key" ON "AliasIngredientImport"("societeId", "texteNormalise");
ALTER TABLE "AliasIngredientImport" ADD CONSTRAINT "AliasIngredientImport_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Produits vendus (texte -> recette)
ALTER TABLE "AliasProduitVenduImport" ADD COLUMN "societeId" INTEGER;
UPDATE "AliasProduitVenduImport" AS a
SET "societeId" = r."societeId"
FROM "Recette" AS r
WHERE r."id" = a."recetteId";
ALTER TABLE "AliasProduitVenduImport" ALTER COLUMN "societeId" SET NOT NULL;
DROP INDEX "AliasProduitVenduImport_texteNormalise_key";
CREATE UNIQUE INDEX "AliasProduitVenduImport_societeId_texteNormalise_key" ON "AliasProduitVenduImport"("societeId", "texteNormalise");
ALTER TABLE "AliasProduitVenduImport" ADD CONSTRAINT "AliasProduitVenduImport_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
