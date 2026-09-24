-- Ajoute la catégorie de recette "Sauces", absente des catégories de référence initiales.
-- ON CONFLICT ... DO NOTHING rend l'insertion sans risque si la ligne existe déjà (même
-- mécanisme que la migration 20260918193000_categorie_recette_accompagnement pour
-- "Accompagnement") : ne modifie ni ne supprime aucune catégorie ou recette existante.

INSERT INTO "CategorieRecette" ("nom", "updatedAt")
VALUES
  ('Sauces', CURRENT_TIMESTAMP)
ON CONFLICT ("nom") DO NOTHING;
