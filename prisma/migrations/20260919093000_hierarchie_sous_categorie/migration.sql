-- Transforme SousCategorieRecette en arborescence à un niveau : une sous-catégorie racine
-- (ex. Viande) peut avoir des sous-catégories enfants (ex. Bœuf, Veau, Porc, Agneau), plutôt
-- que d'empiler des lignes plates au même niveau.
ALTER TABLE "SousCategorieRecette" ADD COLUMN "parentId" INTEGER;

CREATE INDEX "SousCategorieRecette_parentId_idx" ON "SousCategorieRecette"("parentId");

-- AddForeignKey
ALTER TABLE "SousCategorieRecette" ADD CONSTRAINT "SousCategorieRecette_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SousCategorieRecette"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rattache les types de viande ajoutés précédemment (migration 20260919085000) à la
-- sous-catégorie "Viande", au lieu de rester des lignes indépendantes au même niveau.
UPDATE "SousCategorieRecette"
SET "parentId" = (SELECT id FROM "SousCategorieRecette" WHERE "nom" = 'Viande')
WHERE "nom" IN ('Bœuf', 'Veau', 'Porc', 'Agneau');
