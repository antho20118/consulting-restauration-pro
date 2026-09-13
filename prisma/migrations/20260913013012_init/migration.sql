-- CreateEnum
CREATE TYPE "TypeArticle" AS ENUM ('MATIERE_PREMIERE', 'SOUS_RECETTE', 'PRODUIT_FINI', 'EMBALLAGE', 'CONSOMMABLE', 'ENTRETIEN', 'PETIT_MATERIEL');

-- CreateTable
CREATE TABLE "Societe" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "siret" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Societe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Depot" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "societeId" INTEGER NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Depot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categorie" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "couleur" TEXT,
    "icone" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Categorie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TVA" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "taux" DOUBLE PRECISION NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TVA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" SERIAL NOT NULL,
    "type" "TypeArticle" NOT NULL,
    "nom" TEXT NOT NULL,
    "reference" TEXT,
    "codeBarres" TEXT,
    "categorieId" INTEGER NOT NULL,
    "tvaId" INTEGER NOT NULL,
    "societeId" INTEGER NOT NULL,
    "rendement" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fournisseur" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "email" TEXT,
    "siteWeb" TEXT,
    "societeId" INTEGER NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TarifArticle" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "fournisseurId" INTEGER NOT NULL,
    "uniteId" INTEGER NOT NULL,
    "conditionnementId" INTEGER NOT NULL,
    "quantiteConditionnement" DOUBLE PRECISION NOT NULL,
    "prixHT" DOUBLE PRECISION NOT NULL,
    "dateDebut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateFin" TIMESTAMP(3),
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TarifArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "depotId" INTEGER NOT NULL,
    "quantite" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unite" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "symbole" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "facteurBase" DOUBLE PRECISION NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conditionnement" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conditionnement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergene" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Allergene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleAllergene" (
    "articleId" INTEGER NOT NULL,
    "allergeneId" INTEGER NOT NULL,

    CONSTRAINT "ArticleAllergene_pkey" PRIMARY KEY ("articleId","allergeneId")
);

-- CreateTable
CREATE TABLE "ValeurNutritionnelle" (
    "articleId" INTEGER NOT NULL,
    "energie" DOUBLE PRECISION,
    "proteines" DOUBLE PRECISION,
    "glucides" DOUBLE PRECISION,
    "sucres" DOUBLE PRECISION,
    "lipides" DOUBLE PRECISION,
    "acidesGrasSatures" DOUBLE PRECISION,
    "fibres" DOUBLE PRECISION,
    "sel" DOUBLE PRECISION,

    CONSTRAINT "ValeurNutritionnelle_pkey" PRIMARY KEY ("articleId")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER,
    "nom" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "chemin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementStock" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "depotId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "quantite" DOUBLE PRECISION NOT NULL,
    "motif" TEXT,

    CONSTRAINT "MouvementStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recette" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "instructions" TEXT,
    "categorieId" INTEGER,
    "societeId" INTEGER NOT NULL,
    "portions" INTEGER NOT NULL DEFAULT 1,
    "prixVenteHT" DOUBLE PRECISION,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recette_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecetteLigne" (
    "id" SERIAL NOT NULL,
    "recetteId" INTEGER NOT NULL,
    "articleId" INTEGER NOT NULL,
    "quantite" DOUBLE PRECISION NOT NULL,
    "uniteId" INTEGER NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecetteLigne_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Societe_siret_key" ON "Societe"("siret");

-- CreateIndex
CREATE UNIQUE INDEX "Categorie_nom_key" ON "Categorie"("nom");

-- CreateIndex
CREATE INDEX "Article_nom_idx" ON "Article"("nom");

-- CreateIndex
CREATE INDEX "Article_reference_idx" ON "Article"("reference");

-- CreateIndex
CREATE INDEX "Article_codeBarres_idx" ON "Article"("codeBarres");

-- CreateIndex
CREATE INDEX "TarifArticle_articleId_idx" ON "TarifArticle"("articleId");

-- CreateIndex
CREATE INDEX "TarifArticle_fournisseurId_idx" ON "TarifArticle"("fournisseurId");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_articleId_depotId_key" ON "Stock"("articleId", "depotId");

-- CreateIndex
CREATE UNIQUE INDEX "Allergene_code_key" ON "Allergene"("code");

-- CreateIndex
CREATE INDEX "MouvementStock_articleId_idx" ON "MouvementStock"("articleId");

-- CreateIndex
CREATE INDEX "MouvementStock_depotId_idx" ON "MouvementStock"("depotId");

-- CreateIndex
CREATE INDEX "Recette_nom_idx" ON "Recette"("nom");

-- CreateIndex
CREATE INDEX "RecetteLigne_recetteId_idx" ON "RecetteLigne"("recetteId");

-- CreateIndex
CREATE INDEX "RecetteLigne_articleId_idx" ON "RecetteLigne"("articleId");

-- AddForeignKey
ALTER TABLE "Depot" ADD CONSTRAINT "Depot_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "Categorie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_tvaId_fkey" FOREIGN KEY ("tvaId") REFERENCES "TVA"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fournisseur" ADD CONSTRAINT "Fournisseur_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarifArticle" ADD CONSTRAINT "TarifArticle_uniteId_fkey" FOREIGN KEY ("uniteId") REFERENCES "Unite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarifArticle" ADD CONSTRAINT "TarifArticle_conditionnementId_fkey" FOREIGN KEY ("conditionnementId") REFERENCES "Conditionnement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarifArticle" ADD CONSTRAINT "TarifArticle_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarifArticle" ADD CONSTRAINT "TarifArticle_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleAllergene" ADD CONSTRAINT "ArticleAllergene_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleAllergene" ADD CONSTRAINT "ArticleAllergene_allergeneId_fkey" FOREIGN KEY ("allergeneId") REFERENCES "Allergene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValeurNutritionnelle" ADD CONSTRAINT "ValeurNutritionnelle_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recette" ADD CONSTRAINT "Recette_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "Categorie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recette" ADD CONSTRAINT "Recette_societeId_fkey" FOREIGN KEY ("societeId") REFERENCES "Societe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetteLigne" ADD CONSTRAINT "RecetteLigne_recetteId_fkey" FOREIGN KEY ("recetteId") REFERENCES "Recette"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetteLigne" ADD CONSTRAINT "RecetteLigne_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetteLigne" ADD CONSTRAINT "RecetteLigne_uniteId_fkey" FOREIGN KEY ("uniteId") REFERENCES "Unite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
