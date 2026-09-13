-- CreateTable
CREATE TABLE "Menu" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "categorieId" INTEGER,
    "societeId" INTEGER NOT NULL,
    "prixVenteHT" DOUBLE PRECISION,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuLigne" (
    "id" SERIAL NOT NULL,
    "menuId" INTEGER NOT NULL,
    "recetteId" INTEGER NOT NULL,
    "quantite" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "ordre" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenuLigne_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Menu_nom_idx" ON "Menu"("nom");

-- CreateIndex
CREATE INDEX "MenuLigne_menuId_idx" ON "MenuLigne"("menuId");

-- CreateIndex
CREATE INDEX "MenuLigne_recetteId_idx" ON "MenuLigne"("recetteId");

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "CategorieRecette"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuLigne" ADD CONSTRAINT "MenuLigne_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuLigne" ADD CONSTRAINT "MenuLigne_recetteId_fkey" FOREIGN KEY ("recetteId") REFERENCES "Recette"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
