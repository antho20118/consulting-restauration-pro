-- CreateTable
CREATE TABLE "AliasIngredientImport" (
    "id" SERIAL NOT NULL,
    "texteNormalise" TEXT NOT NULL,
    "articleId" INTEGER NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AliasIngredientImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AliasIngredientImport_texteNormalise_key" ON "AliasIngredientImport"("texteNormalise");

-- CreateIndex
CREATE INDEX "AliasIngredientImport_articleId_idx" ON "AliasIngredientImport"("articleId");

-- AddForeignKey
ALTER TABLE "AliasIngredientImport" ADD CONSTRAINT "AliasIngredientImport_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
