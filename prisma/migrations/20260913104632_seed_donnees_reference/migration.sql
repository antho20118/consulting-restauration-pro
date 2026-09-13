-- Insère en base des données de référence introduites par du code applicatif après le premier
-- déploiement (prisma/seed.ts), mais qui ne s'appliquent qu'en rejouant manuellement le seed —
-- une étape facile à oublier. En les insérant directement dans une migration, elles arrivent
-- automatiquement via `prisma migrate deploy`, déjà exécuté au démarrage en production.
-- ON CONFLICT ... DO NOTHING rend l'insertion sans risque si les lignes existent déjà (ex. ajoutées
-- manuellement, ou par un `npm run db:seed` déjà rejoué).

INSERT INTO "CategorieRecette" ("nom", "updatedAt")
VALUES
  ('Entrée', CURRENT_TIMESTAMP),
  ('Plat', CURRENT_TIMESTAMP),
  ('Dessert', CURRENT_TIMESTAMP),
  ('Autre', CURRENT_TIMESTAMP),
  ('Festif', CURRENT_TIMESTAMP),
  ('Mariage', CURRENT_TIMESTAMP)
ON CONFLICT ("nom") DO NOTHING;

INSERT INTO "TVA" ("nom", "taux")
SELECT 'TVA 2,1 %', 2.1
WHERE NOT EXISTS (SELECT 1 FROM "TVA" WHERE "nom" = 'TVA 2,1 %');
