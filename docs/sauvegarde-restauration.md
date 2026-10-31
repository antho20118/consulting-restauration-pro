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

## Sauvegarde automatique hors de Railway (chaque nuit)

Point 1 de l'audit du 15/10 : jusque-là, toutes les données ne vivaient que chez Railway, et l'offre
Hobby n'y fait **aucune** sauvegarde (ni automatique, ni manuelle, ni PITR — vérifié dans l'onglet
Backups le 30/10). Le serveur lui-même (voir `server/utils/sauvegardeExterne/`, démarré dans
`server/server.ts`) fait désormais, **chaque nuit à partir de 3 h (heure de Paris)**, rattrapée dès
que possible si elle a été manquée :

1. un export complet de la base — le même que `npm run db:sauvegarder`, donc restaurable par
   `prisma/restaurer.ts` —, lu dans **une seule transaction PostgreSQL figée et en lecture seule**
   (REPEATABLE READ + READ ONLY) : cohérent même si une saisie arrive pendant l'export, et aucune
   écriture possible sur la base ;
2. **chiffré par une clé publique** (RSA-OAEP 4096 bits + AES-256-GCM) : le serveur sait chiffrer
   mais **ne peut pas déchiffrer** ; seule la clé privée, conservée par le propriétaire hors de
   Railway, le peut. Une fuite des variables Railway (incident du 21/10) ne permet donc de lire
   aucune sauvegarde ;
3. déposé chez un hébergeur **compatible S3** (Scaleway) dans `base/quotidiennes/`, et la première
   du mois aussi dans `base/mensuelles/` ; chaque dépôt est **relu et comparé octet pour octet**
   (empreinte SHA-256) avant d'être considéré comme fait ;
4. les **documents fournisseurs** (photos de factures, listings — sur le disque Railway monté sur
   `/data`, pas en base) absents de l'hébergeur y sont envoyés, chiffrés eux aussi, sous
   `documents/`.

**L'application ne supprime jamais rien** : sa clé d'accès n'en a pas le droit, et son code n'a
aucune opération de suppression. La conservation est assurée par des **règles de cycle de vie
configurées chez l'hébergeur** :

| Dossier | Contenu | Règle chez l'hébergeur |
| --- | --- | --- |
| `base/quotidiennes/` | une sauvegarde par nuit | supprimée après **35 jours** |
| `base/mensuelles/` | la première sauvegarde de chaque mois | supprimée après **25 mois** (760 jours) |
| `documents/` | photos de factures et de listings | jamais supprimés |

Une clé sans droit de suppression peut encore **réécrire** un fichier existant (même nom, autre
contenu), ce qui reviendrait à l'effacer. D'où, chez l'hébergeur, le **versionnage obligatoire** de
l'espace : une réécriture conserve l'ancienne version, que la clé de l'application ne peut pas
supprimer. Les règles de cycle de vie qui suppriment ces **versions anciennes** doivent suivre la
même durée que leur dossier — jamais une durée unique pour tout l'espace, qui effacerait au bout de
35 jours les originaux d'une sauvegarde mensuelle ou d'un document réécrits par un attaquant :

| Dossier | Versions anciennes supprimées après |
| --- | --- |
| `base/quotidiennes/` | 35 jours |
| `base/mensuelles/` | 25 mois (760 jours) |
| `documents/` | jamais |

L'application, elle, n'écrit jamais deux fois sous le même nom (sauvegardes horodatées, documents
envoyés une seule fois). Le verrouillage d'objets (Object Lock), qui interdit toute réécriture ou
suppression pendant une durée donnée, reste une option à étudier à la mise en place.

Avec ces règles, une fuite des clés de l'application ne permet ni d'effacer ni de raccourcir
l'historique : chaque original reste récupérable pendant toute la durée de conservation de son
dossier.

Un échec est inscrit au journal des erreurs (Paramètres) et retenté une heure plus tard. L'état
(dernière réussie, dernier échec, configuration) est affiché en tête de Paramètres → Sauvegardes
(opérateur de la plateforme).

### Mise en place (une seule fois)

1. **Clés de chiffrement** : Paramètres → Sauvegardes → « Générer une paire de clés » (fabriquées
   dans le navigateur, rien n'est envoyé au serveur). La **clé publique** va dans la variable
   Railway `SAUVEGARDE_CLE_PUBLIQUE`. La **clé privée** va dans le gestionnaire de mots de passe du
   propriétaire et sur papier — **jamais dans Railway** (le serveur refuse de démarrer la sauvegarde
   s'il la trouve dans ses variables). En cas de nouvelle paire de clés plus tard, **garder aussi
   l'ancienne clé privée** : elle reste la seule à pouvoir relire les sauvegardes déjà faites.
2. **Hébergeur** : un espace de stockage dédié, **versionnage activé**, les règles de cycle de vie
   ci-dessus (fichiers et versions anciennes, dossier par dossier), et une clé d'accès
   limitée à cet espace avec les droits **déposer, lire, lister — sans suppression, ni des fichiers
   ni de leurs versions** (à vérifier chez l'hébergeur au moment de la mise en place).
3. **Variables Railway** (production ; staging avec un espace ou un `SAUVEGARDE_S3_PREFIXE` séparé) :

| Variable | Exemple / rôle |
| --- | --- |
| `SAUVEGARDE_S3_ENDPOINT` | `https://s3.fr-par.scw.cloud` |
| `SAUVEGARDE_S3_REGION` | `fr-par` |
| `SAUVEGARDE_S3_BUCKET` | nom de l'espace de stockage |
| `SAUVEGARDE_S3_ACCESS_KEY_ID` | clé d'accès (sans droit de suppression) |
| `SAUVEGARDE_S3_SECRET_ACCESS_KEY` | clé secrète |
| `SAUVEGARDE_CLE_PUBLIQUE` | clé publique produite par le générateur |
| `SAUVEGARDE_S3_PREFIXE` | facultatif : dossier dans l'espace (ex. `production`) |

Aucune variable : fonction désactivée. Configuration partielle ou dangereuse : signalée (journal
des erreurs, Paramètres), jamais une sauvegarde à moitié configurée. Retirer les variables suffit à
désactiver la fonction, sans redéployer de code.

### Récupérer une sauvegarde externe

Depuis n'importe quel ordinateur, avec les variables `SAUVEGARDE_S3_*` ci-dessus et
`SAUVEGARDE_CLE_PRIVEE` (la clé privée du propriétaire — sur cet ordinateur seulement) :

```bash
npm run db:recuperer-sauvegarde-externe -- liste
npm run db:recuperer-sauvegarde-externe -- base derniere sauvegarde.json
npm run db:recuperer-sauvegarde-externe -- documents dossier-documents
```

Le fichier `sauvegarde.json` obtenu se restaure comme une sauvegarde manuelle (voir « Dry-run » et
« Restaurer réellement » ci-dessous) ; le contenu de `dossier-documents` se recopie tel quel à la
racine de `DOCUMENTS_STORAGE_PATH`. Aucun fichier existant n'est jamais écrasé.

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

- **Taille de la base pour la sauvegarde hors de Railway** : l'export est construit en mémoire dans
  le processus de l'application (JSON, compression, chiffrement), photos des plats comprises.
  Négligeable aujourd'hui (une base de quelques mégaoctets) ; à surveiller dans les métriques
  Railway si la base dépasse une centaine de mégaoctets — il faudrait alors passer à un export en
  flux (table par table, compression et chiffrement au fil de l'eau, envoi en plusieurs parties).

- **Sauvegarde du volume physique** : les documents fournisseurs (`fournisseurs/`) sont désormais
  copiés chaque nuit hors de Railway (voir « Sauvegarde automatique hors de Railway »). Le PITR
  (restauration à la minute près) du plan Railway Pro n'est pas en place : la sauvegarde
  automatique est quotidienne, une journée de saisies au plus peut donc être perdue.
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
