# Sauvegarde et restauration (F08)

Ce document couvre le mécanisme de sauvegarde (`prisma/sauvegarder.ts`) et de restauration
(`prisma/restaurer.ts`) mis en place pour F08 de l'audit forensique. Il complète les commentaires
en tête de ces deux fichiers, qui restent la référence technique précise.

## Créer une sauvegarde

```bash
npm run db:sauvegarder
```

Écrit un fichier JSON horodaté dans `<DOCUMENTS_STORAGE_PATH>/sauvegardes/`. Le fichier est
ensuite téléchargeable depuis l'application (`GET /api/sauvegardes`, jeton requis — voir la page
Paramètres), pour être copié ailleurs que sur le disque Railway qui l'a produit. **Ce script seul
ne protège pas contre un incident sur Railway lui-même** : il protège contre une erreur de
manipulation ou un bug applicatif qui corromprait les données en base, à condition que le fichier
produit soit ensuite effectivement stocké hors de Railway. Un stockage off-site automatisé (S3,
etc.) et le PITR (Point-In-Time Recovery) du plan Railway Pro restent hors périmètre dépôt — voir
« Limites » plus bas.

## Format du fichier (`formatVersion`)

Chaque sauvegarde est une enveloppe :

```json
{
  "formatVersion": 1,
  "creeLe": "2026-10-06T12:00:00.000Z",
  "derniereMigrationAppliquee": "20261005170000_cloisonne_referentiels_categories",
  "modeles": { "Societe": [...], "Article": [...], "...": [...] }
}
```

- **`formatVersion`** ne versionne que la *forme* de l'enveloppe elle-même (ses champs). Il
  n'augmente que si cette structure change (par exemple l'ajout d'un nouveau champ obligatoire à
  l'enveloppe) — jamais à cause d'une évolution du schéma Prisma.
- **`derniereMigrationAppliquee`** est lue depuis `_prisma_migrations` au moment de la sauvegarde,
  jamais déduite de `schema.prisma` ni d'un nom de fichier. C'est ce champ qui permet à
  `restaurer.ts` de savoir à quel point exact de l'historique des migrations correspondent les
  données du fichier, pour les faire évoluer jusqu'au schéma courant en rejouant les vraies
  migrations du dépôt (voir « Comment ça marche » plus bas) — jamais un second système de
  versionnement JSON→JSON parallèle aux migrations Prisma.
- Une sauvegarde créée **avant** la mise en place de F08 n'a pas de `formatVersion` : elle est
  refusée automatiquement, avec un message explicite (« format historique non supporté
  automatiquement »). Elle n'est pas pour autant perdue — une récupération manuelle exceptionnelle
  reste possible en inspectant le fichier directement, simplement non automatisée.

## Comment ça marche (rejeu des migrations)

`restaurer.ts` ne restaure jamais un vieux JSON directement contre le schéma courant. Il :

1. construit un dossier de migrations tronqué au point `derniereMigrationAppliquee` (copie, jamais
   une modification des fichiers réels) et l'applique (`prisma migrate deploy`) sur la cible : le
   schéma de la cible redevient alors identique à celui qui existait au moment de la sauvegarde ;
2. charge les données de la sauvegarde dans cet état de schéma ancien, dans l'ordre topologique
   réel des dépendances de clé étrangère (calculé depuis le schéma Prisma, jamais une liste
   recopiée à la main — voir `prisma/utils/ordreRestauration.ts`) ;
3. rejoue ensuite **toutes** les migrations restantes du dépôt, dans leur ordre normal — y compris
   celles qui transforment des données (backfills, conversions de table) — jusqu'au schéma
   courant ;
4. vérifie l'intégrité du résultat (comptages, migration finale, invariants multi-société).

C'est le même mécanisme, et le même code (`construireDossierMigrationsTronque`), qui gère une
sauvegarde du schéma courant (étape 1 n'applique alors aucune migration supplémentaire, étape 3
n'en rejoue aucune) et une sauvegarde ancienne — voir `tests/unit/restaurerScript.test.ts`, qui
teste les deux cas réellement (vrai PostgreSQL, vraies migrations), dont un scénario historique
dédié qui démontre qu'une migration de transformation de données (conversion de l'ancien compte
unique `AccesApplication` en `Utilisateur` nominatif, suivie de la suppression de la table) et une
migration de backfill (rattachement rétroactif de `Categorie` à une société, F11) s'exécutent
correctement sur des données chargées depuis une ancienne sauvegarde.

## Règle permanente : immuabilité des migrations historiques

**Toute migration présente dans `prisma/migrations/` au moment où une sauvegarde peut la
référencer (via `derniereMigrationAppliquee`) devient immuable** : son SQL ne doit plus jamais être
modifié, réécrit, supprimé ou renommé. Une correction nécessaire passe toujours par une **nouvelle**
migration additive ou corrective, jamais par une modification d'une migration existante. En
pratique, dès qu'une migration a été mergée sur `main`, elle doit être considérée comme immuable
pour cette seule raison — des sauvegardes réelles peuvent déjà la référencer.

Cette règle est documentée ici ainsi qu'en tête de `prisma/restaurer.ts`, qui lit et rejoue les
migrations existantes mais ne les modifie jamais.

## Dry-run

```bash
RESTORE_TARGET_DATABASE_URL=postgresql://... npm run db:restaurer -- chemin/vers/sauvegarde.json --dry-run
```

Un dry-run exécute le pipeline complet de restauration (création d'une base PostgreSQL éphémère,
migrations, chargement des données, migrations restantes, contrôles d'intégrité) **réellement**,
puis détruit la base éphémère. `RESTORE_TARGET_DATABASE_URL` sert uniquement à localiser le serveur
PostgreSQL sur lequel créer cette base jetable — jamais la base qu'elle désigne elle-même, qui
n'est jamais touchée par un dry-run (vérifié par un test dédié).

## Restaurer réellement

```bash
RESTORE_TARGET_DATABASE_URL=postgresql://... npm run db:restaurer -- chemin/vers/sauvegarde.json
```

**`RESTORE_TARGET_DATABASE_URL` doit désigner une base PostgreSQL réellement vierge** (aucune table
dans son schéma `public`) — jamais une base existante, et surtout jamais `DATABASE_URL`, qui n'est
jamais utilisée implicitement comme cible. Il n'existe **aucun** mécanisme de contournement
(`--force`, `--overwrite`, confirmation interactive, etc.) : une cible non vierge est refusée sans
exception. Le flux réel en cas de restauration d'urgence est :

1. Production endommagée.
2. Provisionner une **nouvelle** base PostgreSQL vide (jamais réutiliser l'ancienne).
3. Lancer la restauration vers cette nouvelle base.
4. Vérifier le rapport d'intégrité produit (comptages, migration finale, invariants société,
   fichiers fournisseurs orphelins).
5. **Validation humaine** du rapport.
6. **Bascule manuelle** de la variable `DATABASE_URL` de l'application vers la nouvelle base.

`restaurer.ts` n'effectue jamais lui-même cette bascule — elle reste un acte humain délibéré,
après vérification du rapport.

### En cas d'échec pendant la restauration

Si une migration échoue pendant le rejeu, la restauration est un échec complet : la base cible est
considérée invalide et doit être jetée, jamais réparée ni réutilisée. Il faut repartir d'une
nouvelle base vierge. Le script ne tente jamais de « réparer » une restauration interrompue.

## Fichiers fournisseurs (`DocumentFournisseur`)

La sauvegarde JSON contient les métadonnées de `DocumentFournisseur`/`LigneDocumentFournisseur`,
jamais les fichiers binaires eux-mêmes. Après une restauration, si `DOCUMENTS_STORAGE_PATH` est
définie, le rapport signale les fichiers physiques référencés mais absents (« orphelins ») — ceci
**n'est jamais traité comme une corruption de la base** : la base peut être restaurée avec succès
même si certains fichiers physiques manquent (ils dépendent d'une sauvegarde de volume séparée,
hors périmètre dépôt — voir « Limites »).

## Limites connues

- **Sauvegarde du volume physique** (fichiers `fournisseurs/`, et le fichier de sauvegarde JSON
  lui-même une fois écrit) : relève de l'infrastructure (volume Railway), pas de ce dépôt. Un
  stockage off-site automatisé et le PITR du plan Railway Pro restent à mettre en place séparément.
- **Droits PostgreSQL réels sur Railway** : le dry-run nécessite de créer/détruire une base
  (`CREATE DATABASE`/`DROP DATABASE`), vérifié en local et en CI (rôle superutilisateur de l'image
  officielle `postgres`). Le rôle applicatif réellement attribué par Railway n'a pas été vérifié
  dans ce chantier — si ce droit manque, l'erreur PostgreSQL de permission est explicite (pas
  d'échec silencieux), mais le dry-run ne sera simplement pas disponible tel quel dans cet
  environnement.
- **Donnée d'un modèle supprimé par une migration ultérieure** : **résolu**. Le chargement d'un
  backup historique est piloté par une introspection directe du schéma PostgreSQL réellement
  matérialisé après la phase 1 (voir `prisma/utils/introspectionSchema.ts` et
  `prisma/utils/grapheIntrospection.ts`), jamais par le DMMF Prisma courant — une table depuis
  supprimée (ex. `AccesApplication`, supprimée par `20260930090000_utilisateurs_roles`) est donc
  découverte et rechargée comme n'importe quelle autre table. Démontré par un test de provenance
  dédié (`tests/unit/restaurerScript.test.ts`, scénario avec une valeur `AccesApplication`
  distinctive propagée jusqu'à l'`Utilisateur` final) et un test générique au niveau du module
  d'introspection (`tests/unit/introspectionSchema.test.ts`).
- **Types Prisma `Decimal`, `BigInt`, `Bytes`** : non exercés par les tests ni garantis par la
  conversion de valeur (`convertirValeur` dans `prisma/restaurer.ts`), car aucun champ de ces types
  n'existe actuellement dans `prisma/schema.prisma` (vérifié par recherche sur le schéma). Les types
  effectivement exercés et validés (DateTime, enum, Json/Jsonb, scalaires numériques/texte/booléen)
  fonctionnent par introspection du type PostgreSQL réel. Si un champ `Decimal`, `BigInt` ou `Bytes`
  est introduit un jour, la conversion de valeur et son insertion doivent être revérifiées
  explicitement avant de considérer une restauration historique le couvrant comme fiable.
