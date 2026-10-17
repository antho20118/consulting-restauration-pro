-- Saisies faites hors connexion (point 9 de l'audit du 15/10) : clé unique fournie par l'appareil,
-- pour qu'une production ou un contrôle HACCP renvoyé après une réponse perdue ne soit jamais
-- enregistré deux fois. Absente (NULL) pour toutes les saisies existantes et en ligne.
ALTER TABLE "Production" ADD COLUMN "cleIdempotence" TEXT;
ALTER TABLE "ControleHACCPProduction" ADD COLUMN "cleIdempotence" TEXT;
CREATE UNIQUE INDEX "Production_cleIdempotence_key" ON "Production"("cleIdempotence");
CREATE UNIQUE INDEX "ControleHACCPProduction_cleIdempotence_key" ON "ControleHACCPProduction"("cleIdempotence");
