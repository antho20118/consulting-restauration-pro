-- Ajoute une sous-catégorie "Céréales" (racine) pour les féculents qui n'entrent ni dans
-- Riz ni dans Pâtes (polenta, semoule, boulgour, quinoa, épeautre, orge, maïs). ON CONFLICT ...
-- DO NOTHING rend l'insertion sans risque si les lignes existent déjà.
INSERT INTO "SousCategorieRecette" ("nom", "updatedAt")
VALUES ('Céréales', CURRENT_TIMESTAMP)
ON CONFLICT ("nom") DO NOTHING;

INSERT INTO "SousCategorieRecette" ("nom", "parentId", "updatedAt")
SELECT enfant.nom, racine.id, CURRENT_TIMESTAMP
FROM (VALUES ('Polenta'), ('Semoule'), ('Boulgour'), ('Quinoa'), ('Épeautre'), ('Orge'), ('Maïs')) AS enfant(nom)
CROSS JOIN (SELECT id FROM "SousCategorieRecette" WHERE "nom" = 'Céréales') AS racine
ON CONFLICT ("nom") DO NOTHING;
