-- F11 de l'audit forensique : Categorie, CategorieRecette et SousCategorieRecette deviennent
-- propres à chaque société (contrairement à TVA et Unite, qui restent volontairement partagés —
-- voir les commentaires de ces deux modèles dans schema.prisma). Décision métier : chaque
-- restaurant organise ses ingrédients et ses recettes à sa façon ; les taux de TVA et les unités
-- de mesure, eux, sont des référentiels standard qu'il n'y a aucune raison de dupliquer.

-- DropIndex (ancienne contrainte d'unicité globale sur le nom seul)
DROP INDEX "Categorie_nom_key";
DROP INDEX "CategorieRecette_nom_key";
DROP INDEX "SousCategorieRecette_nom_key";

-- AlterTable (colonne nullable dans un premier temps, pour pouvoir la remplir avant de la rendre obligatoire)
ALTER TABLE "Categorie" ADD COLUMN "societeId" INTEGER;
ALTER TABLE "CategorieRecette" ADD COLUMN "societeId" INTEGER;
ALTER TABLE "SousCategorieRecette" ADD COLUMN "societeId" INTEGER;

-- Garantit qu'une société existe pour porter les catégories déjà présentes : certaines sont
-- insérées en dur par des migrations antérieures (20260913104632_seed_donnees_reference et les
-- migrations categorie_recette_*/sous_categorie_*), alors que "Societe" n'est elle-même créée que
-- par l'application ou prisma/seed.ts, jamais par une migration — sur une base neuve (constaté en
-- CI), "Societe" est donc encore vide à ce stade et le backfill ci-dessous assignerait NULL sans
-- cette ligne, faisant échouer la contrainte NOT NULL plus bas.
INSERT INTO "Societe" ("nom", "updatedAt")
SELECT 'Mon entreprise', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Societe");

-- Migration des données : à la date de cette migration, une seule société existe (voir le même
-- principe déjà appliqué dans 20260930090000_utilisateurs_roles) — toutes les lignes existantes de
-- ces trois tables lui sont rattachées, puisqu'elles étaient de facto partagées par cette société
-- unique jusqu'ici.
UPDATE "Categorie" SET "societeId" = (SELECT "id" FROM "Societe" ORDER BY "id" ASC LIMIT 1) WHERE "societeId" IS NULL;
UPDATE "CategorieRecette" SET "societeId" = (SELECT "id" FROM "Societe" ORDER BY "id" ASC LIMIT 1) WHERE "societeId" IS NULL;
UPDATE "SousCategorieRecette" SET "societeId" = (SELECT "id" FROM "Societe" ORDER BY "id" ASC LIMIT 1) WHERE "societeId" IS NULL;

-- AlterTable (colonne désormais obligatoire)
ALTER TABLE "Categorie" ALTER COLUMN "societeId" SET NOT NULL;
ALTER TABLE "CategorieRecette" ALTER COLUMN "societeId" SET NOT NULL;
ALTER TABLE "SousCategorieRecette" ALTER COLUMN "societeId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Categorie" ADD CONSTRAINT "Categorie_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CategorieRecette" ADD CONSTRAINT "CategorieRecette_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SousCategorieRecette" ADD CONSTRAINT "SousCategorieRecette_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (nouvelle contrainte d'unicité, par société — un même nom peut désormais exister dans deux sociétés différentes)
CREATE UNIQUE INDEX "Categorie_societeId_nom_key" ON "Categorie"("societeId", "nom");
CREATE UNIQUE INDEX "CategorieRecette_societeId_nom_key" ON "CategorieRecette"("societeId", "nom");
CREATE UNIQUE INDEX "SousCategorieRecette_societeId_nom_key" ON "SousCategorieRecette"("societeId", "nom");
