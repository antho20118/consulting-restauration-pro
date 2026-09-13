# Consulting Restauration Pro

Application de gestion pour la restauration : ingrédients (fournisseurs, tarifs, allergènes), fiches techniques avec calcul de coût et de food cost, dépôts et mouvements de stock, et un tableau de bord.

## Stack

- **Frontend** : React 19, Vite, MUI (`@mui/x-data-grid`), React Router, Tailwind CSS
- **Backend** : Express 5, Prisma 6
- **Base de données** : PostgreSQL (`prisma/schema.prisma`)

## Démarrage en local

Un PostgreSQL local est nécessaire. Le plus simple est Docker :

```bash
docker compose up -d
```

Puis :

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run db:seed
```

Enfin, dans deux terminaux séparés :

```bash
npm run server   # API Express sur http://localhost:3000
npm run dev      # Frontend Vite sur http://localhost:5173
```

## Variables d'environnement

Voir `.env.example` :

- `DATABASE_URL` : chaîne de connexion PostgreSQL
- `VITE_API_URL` : URL de base de l'API consommée par le frontend (le préfixe `/api` est ajouté automatiquement, voir `src/config/api.ts`)

## Déploiement

L'app se déploie comme un seul service : en production, le serveur Express sert à la fois l'API (sous `/api/*`) et les fichiers statiques du frontend buildé (`npm run build`). Les scripts `build` et `start` sont déjà configurés pour ça (`package.json`) : `start` applique les migrations Prisma en attente (`prisma migrate deploy`) puis démarre le serveur.

### Sur Railway (recommandé)

1. Crée un compte sur [railway.app](https://railway.app) et un nouveau projet.
2. Ajoute une base **PostgreSQL** (bouton "New" → "Database" → "PostgreSQL") — Railway fournit automatiquement une variable `DATABASE_URL`.
3. Ajoute un service à partir de ce dépôt GitHub ("New" → "GitHub Repo").
4. Dans les variables d'environnement du service :
   - Relie `DATABASE_URL` à celle générée par la base PostgreSQL (Railway propose une référence automatique entre services).
   - Ajoute `VITE_API_URL` avec une valeur **vide** (`VITE_API_URL=`) — le frontend appellera alors l'API sur son propre domaine via des chemins relatifs (`/api/...`), ce qui évite tout problème de CORS.
5. Build command : `npm run build` — Start command : `npm start` (Railway les détecte généralement seul depuis `package.json`, mais vérifie dans les réglages du service).
6. Déploie. Une fois en ligne, `npm run db:seed` peut être lancé une fois via le terminal Railway du service (`railway run npm run db:seed`) pour peupler les données de référence (catégories, unités, TVA, allergènes).

### Sur une autre plateforme (Render, Fly.io, VPS...)

Le principe est identique : fournir une base PostgreSQL accessible via `DATABASE_URL`, définir `VITE_API_URL=` (vide) avant le build du frontend, lancer `npm install && npm run build` puis `npm start`.

## État actuel

Modules fonctionnels : Tableau de bord, Fiches techniques (recettes), Base ingrédients (avec allergènes), Fournisseurs, Mouvements de stock, Dépôts, Paramètres (société, catégories, unités, TVA). Export Excel disponible sur les pages Ingrédients et Recettes.
