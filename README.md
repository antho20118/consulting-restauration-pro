# Consulting Restauration Pro

Application de gestion pour la restauration : base d'articles/ingrédients (fournisseurs, tarifs, stocks, allergènes, valeurs nutritionnelles), avec pour objectif d'ajouter à terme les fiches techniques (recettes) et un tableau de bord.

## Stack

- **Frontend** : React 19, Vite, MUI (`@mui/x-data-grid`), React Router, Tailwind CSS
- **Backend** : Express 5, Prisma 6
- **Base de données** : SQLite en local (`prisma/schema.prisma`)

## Démarrage

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run db:seed
```

Puis, dans deux terminaux séparés :

```bash
npm run server   # API Express sur http://localhost:3000
npm run dev      # Frontend Vite
```

## Variables d'environnement

Voir `.env.example` :

- `DATABASE_URL` : chaîne de connexion Prisma (SQLite par défaut)
- `VITE_API_URL` : URL de l'API consommée par le frontend

## État actuel

Le module **Ingrédients** (`src/features/ingredients`) est fonctionnel : liste, création, recherche. Les modules **Recettes**, **Tableau de bord** et **Paramètres** sont encore des pages vides (`src/routes/AppRoutes.tsx`).
