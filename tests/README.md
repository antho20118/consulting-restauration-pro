# Suite de tests

## Pré-requis

- Node 22
- `npm ci`
- Pour les tests unitaires : aucune base PostgreSQL n'est nécessaire.
- Pour les tests d'intégration : PostgreSQL local via Docker.

## Commandes

```bash
npm ci
npm run typecheck
npm run test:unit
npm run test:smoke
npm test
```

## Tests avec PostgreSQL

```bash
docker compose up -d
cp .env.test.example .env
npx prisma migrate deploy
npm run db:seed
```

Les tests d'intégration PostgreSQL seront ajoutés après validation du schéma et de la migration dans l'environnement local.

## Règle

Un test métier doit documenter une valeur attendue. Les tests ne doivent pas seulement vérifier que l'API répond 200 : ils doivent vérifier le résultat métier (coût, rendement, stock, allergènes, production, etc.).

## Base de test isolée

Pour éviter de toucher à la base de développement :

```bash
docker compose -f docker-compose.test.yml up -d
cp .env.test.example .env
npx prisma migrate deploy
npm run db:seed
```

La base de test écoute sur `localhost:5433` et s'appelle `consulting_test`.
