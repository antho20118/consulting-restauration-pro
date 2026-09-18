-- Ajoute la catégorie de recette "Accompagnement", absente des catégories de référence
-- initiales. ON CONFLICT ... DO NOTHING rend l'insertion sans risque si la ligne existe déjà.

INSERT INTO "CategorieRecette" ("nom", "updatedAt")
VALUES
  ('Accompagnement', CURRENT_TIMESTAMP)
ON CONFLICT ("nom") DO NOTHING;
