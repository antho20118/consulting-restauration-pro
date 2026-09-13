-- Réinitialise l'identifiant/code de connexion à leur valeur par défaut (admin / 1234) : l'utilisateur
-- a changé le code depuis Paramètres sans le noter et s'est retrouvé bloqué hors de l'application.
-- Hash bcrypt précalculé pour '1234' (même procédé que la migration acces_application initiale).
UPDATE "AccesApplication"
SET "identifiant" = 'admin',
    "codeHache" = '$2b$10$TVP0dJOt5vY8uSvoVa/Q.Odgqmv1TlpdxSy35yd8nJxgHSULyTtKG',
    "updatedAt" = CURRENT_TIMESTAMP;
