-- Précise le type de viande, plutôt que la seule sous-catégorie générique "Viande".
-- ON CONFLICT ... DO NOTHING rend l'insertion sans risque si les lignes existent déjà.
INSERT INTO "SousCategorieRecette" ("nom", "updatedAt")
VALUES
  ('Bœuf', CURRENT_TIMESTAMP),
  ('Veau', CURRENT_TIMESTAMP),
  ('Porc', CURRENT_TIMESTAMP),
  ('Agneau', CURRENT_TIMESTAMP)
ON CONFLICT ("nom") DO NOTHING;
