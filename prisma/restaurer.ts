// F08 de l'audit forensique : restauration d'une sauvegarde versionnée (voir prisma/sauvegarder.ts)
// vers une base PostgreSQL vierge, en rejouant les vraies migrations Prisma pour faire évoluer une
// ancienne sauvegarde jusqu'au schéma courant — jamais un deuxième système de migration JSON→JSON
// parallèle (voir la conception F08 phase 2).
//
// CORRECTIF (suite à un audit indépendant) : le chargement des données d'un backup HISTORIQUE
// n'utilise plus le DMMF courant (Prisma.dmmf), qui ne connaît plus un modèle/table supprimé par
// une migration ultérieure (cas réel : AccesApplication, voir 20260930090000_utilisateurs_roles).
// À la place, juste après la phase 1 (migrations rejouées jusqu'au point du backup), le schéma
// RÉELLEMENT matérialisé dans PostgreSQL à cet instant est introspecté directement (voir
// prisma/utils/introspectionSchema.ts et prisma/utils/grapheIntrospection.ts) — tables, colonnes,
// types, clés primaires et relations FK réelles — et c'est CE schéma, pas le DMMF courant, qui
// pilote chargerDonnees ci-dessous. Le DMMF courant reste utilisé ailleurs : pour le pré-contrôle
// rapide de cohérence du schéma COURANT lui-même (cycles FK), et pour les contrôles d'intégrité
// finaux (invariants société, migration finale) qui s'exécutent APRÈS le rattrapage, quand le
// schéma de la cible est bien devenu le schéma courant.
//
// RÈGLE PERMANENTE : toute migration présente dans prisma/migrations/ au moment où une sauvegarde
// peut la référencer (via derniereMigrationAppliquee) devient IMMUABLE — jamais modifiée, réécrite,
// supprimée ou renommée. Toute correction passe par une nouvelle migration additive. Ce script lit
// et rejoue les migrations existantes, ne les modifie jamais.
//
// GARDE-FOUS (non contournables en V1, volontairement — voir la conception F08 phase 2) :
//   - jamais DATABASE_URL comme cible implicite : exige RESTORE_TARGET_DATABASE_URL ;
//   - la cible doit être prouvée vierge (aucune table dans son schéma "public") avant toute
//     écriture, sans exception ni option de contournement (--force/--overwrite n'existent pas) ;
//   - les contraintes FK PostgreSQL restent actives tout le long (jamais
//     `session_replication_role = replica` ni équivalent) ;
//   - toute migration qui échoue pendant le rejeu invalide immédiatement la cible : aucune
//     tentative de réparation, aucune poursuite, recommencer depuis une base vierge.
//
// Usage :
//   npx tsx prisma/restaurer.ts <fichier-sauvegarde.json> --dry-run
//   RESTORE_TARGET_DATABASE_URL=... npx tsx prisma/restaurer.ts <fichier-sauvegarde.json>

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";
import { construireGrapheRestauration, type GrapheRestauration } from "./utils/ordreRestauration.js";
import { construireGrapheDepuisIntrospection } from "./utils/grapheIntrospection.js";
import { introspecterSchema, type SchemaIntrospecte, type ColonneIntrospectee } from "./utils/introspectionSchema.js";
import { derniereMigrationAppliquee } from "./utils/migrationsAppliquees.js";
import { realignerSequences, type RealignementSequence } from "./utils/realignementSequences.js";

const RACINE_DEPOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const DOSSIER_MIGRATIONS_REEL = path.join(RACINE_DEPOT, "prisma", "migrations");
const FORMAT_VERSION_SUPPORTEE = 1;

export class SauvegardeInvalideError extends Error {}
export class CibleNonVierge extends Error {}
export class EchecMigrationError extends Error {}
export class ViolationIntegriteError extends Error {}

// ============================================================================================
// 1. Lecture et validation de l'enveloppe de sauvegarde (voir §9 de la conception : échouer tôt,
//    jamais de tentative de restauration partielle sur un fichier douteux).
// ============================================================================================

export type EnveloppeSauvegarde = {
  formatVersion: number;
  creeLe: string;
  derniereMigrationAppliquee: string;
  modeles: Record<string, unknown[]>;
};

export async function lireEtValiderSauvegarde(cheminFichier: string): Promise<EnveloppeSauvegarde> {
  let texte: string;
  try {
    texte = await fs.readFile(cheminFichier, "utf8");
  } catch (erreur) {
    throw new SauvegardeInvalideError(`Fichier de sauvegarde illisible : ${(erreur as Error).message}`);
  }

  let donnees: unknown;
  try {
    donnees = JSON.parse(texte);
  } catch (erreur) {
    throw new SauvegardeInvalideError(`JSON invalide ou fichier tronqué : ${(erreur as Error).message}`);
  }

  if (typeof donnees !== "object" || donnees === null || Array.isArray(donnees)) {
    throw new SauvegardeInvalideError("Le fichier de sauvegarde doit être un objet JSON.");
  }
  const d = donnees as Record<string, unknown>;

  if (typeof d.formatVersion !== "number") {
    throw new SauvegardeInvalideError(
      "Format historique non supporté automatiquement : aucun champ formatVersion trouvé. " +
        "Cette sauvegarde a été créée avant la mise en place de la restauration automatisée (F08) — " +
        "elle n'est pas restaurable par ce script. Une récupération manuelle exceptionnelle reste " +
        "possible en inspectant le fichier directement, mais n'est pas automatisée."
    );
  }
  if (d.formatVersion !== FORMAT_VERSION_SUPPORTEE) {
    throw new SauvegardeInvalideError(
      `formatVersion ${d.formatVersion} inconnu de cette version de restaurer.ts (seul ${FORMAT_VERSION_SUPPORTEE} est supporté).`
    );
  }
  if (typeof d.derniereMigrationAppliquee !== "string" || d.derniereMigrationAppliquee.trim() === "") {
    throw new SauvegardeInvalideError("Champ derniereMigrationAppliquee absent ou invalide.");
  }
  if (typeof d.creeLe !== "string") {
    throw new SauvegardeInvalideError("Champ creeLe absent ou invalide.");
  }
  if (typeof d.modeles !== "object" || d.modeles === null || Array.isArray(d.modeles)) {
    throw new SauvegardeInvalideError("Champ modeles absent ou invalide.");
  }
  const modeles = d.modeles as Record<string, unknown>;
  for (const [nom, lignes] of Object.entries(modeles)) {
    if (!Array.isArray(lignes)) {
      throw new SauvegardeInvalideError(`modeles.${nom} n'est pas un tableau — structure de sauvegarde invalide.`);
    }
  }

  // La migration déclarée doit exister réellement dans le dépôt courant — sinon la sauvegarde
  // référence un état de schéma que ce dépôt ne connaît pas (dépôt différent, historique tronqué,
  // ou fichier corrompu/modifié à la main).
  const migrationsReelles = await listerDossiersMigrations(DOSSIER_MIGRATIONS_REEL);
  if (!migrationsReelles.includes(d.derniereMigrationAppliquee as string)) {
    throw new SauvegardeInvalideError(
      `derniereMigrationAppliquee "${d.derniereMigrationAppliquee}" ne correspond à aucune migration connue de ce dépôt.`
    );
  }

  return {
    formatVersion: d.formatVersion,
    creeLe: d.creeLe,
    derniereMigrationAppliquee: d.derniereMigrationAppliquee as string,
    modeles: modeles as Record<string, unknown[]>,
  };
}

async function listerDossiersMigrations(dossier: string): Promise<string[]> {
  const entrees = await fs.readdir(dossier, { withFileTypes: true });
  return entrees.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// ============================================================================================
// 2. Rejeu des migrations — construit un dossier de migrations tronqué (jusqu'à un point donné
//    inclus) et lance `prisma migrate deploy` dessus. Jamais de modification des fichiers de
//    migration réels : uniquement des copies dans un répertoire temporaire jetable.
// ============================================================================================

// jusquA === null signifie "toutes les migrations réelles du dépôt" (phase de rattrapage vers le
// schéma courant) ; une valeur précise tronque à ce point inclus (phase de reconstruction du
// schéma d'origine du backup).
export async function construireDossierMigrationsTronque(jusquA: string | null): Promise<string> {
  const migrationsReelles = await listerDossiersMigrations(DOSSIER_MIGRATIONS_REEL);
  const sousEnsemble = jusquA === null ? migrationsReelles : migrationsReelles.slice(0, migrationsReelles.indexOf(jusquA) + 1);

  const dossierTemp = path.join(await fs.realpath(os.tmpdir()), `f08-restaurer-${randomUUID()}`);
  const dossierPrisma = path.join(dossierTemp, "prisma");
  const dossierMigrations = path.join(dossierPrisma, "migrations");
  await fs.mkdir(dossierMigrations, { recursive: true });

  await fs.copyFile(
    path.join(DOSSIER_MIGRATIONS_REEL, "migration_lock.toml"),
    path.join(dossierMigrations, "migration_lock.toml")
  );
  for (const nom of sousEnsemble) {
    await fs.cp(path.join(DOSSIER_MIGRATIONS_REEL, nom), path.join(dossierMigrations, nom), { recursive: true });
  }
  await fs.copyFile(path.join(RACINE_DEPOT, "prisma", "schema.prisma"), path.join(dossierPrisma, "schema.prisma"));
  await fs.writeFile(
    path.join(dossierTemp, "prisma.config.ts"),
    `import { defineConfig } from "prisma/config";\nexport default defineConfig({ schema: "prisma/schema.prisma" });\n`
  );
  await fs.symlink(path.join(RACINE_DEPOT, "node_modules"), path.join(dossierTemp, "node_modules"), "dir");

  return dossierTemp;
}

function executerMigrateDeploy(dossierTravail: string, urlCible: string): { succes: boolean; sortie: string } {
  try {
    const sortie = execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: dossierTravail,
      env: { ...process.env, DATABASE_URL: urlCible },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { succes: true, sortie };
  } catch (erreur) {
    const e = erreur as { stdout?: string; stderr?: string; message: string };
    return { succes: false, sortie: `${e.stdout ?? ""}\n${e.stderr ?? e.message}` };
  }
}

// ============================================================================================
// 3. Garde-fous cible : jamais DATABASE_URL implicite, cible toujours prouvée vierge.
// ============================================================================================

export function resoudreUrlCible(dryRun: boolean, nomBaseEphemere: string): { urlServeur: string; urlCible: string } {
  // En dry-run, RESTORE_TARGET_DATABASE_URL sert UNIQUEMENT à localiser le serveur PostgreSQL
  // (hôte/port/identifiants) sur lequel créer la base éphémère — jamais comme cible d'écriture
  // réelle (voir resoudreUrlCible plus bas : la base éphémère porte toujours son propre nom
  // aléatoire). Jamais de repli sur DATABASE_URL, qui pourrait être la production.
  const urlServeurBrute = process.env.RESTORE_TARGET_DATABASE_URL;
  if (!urlServeurBrute) {
    throw new Error(
      "RESTORE_TARGET_DATABASE_URL non définie. Ce script n'utilise jamais DATABASE_URL implicitement " +
        "(qui pourrait être la base de production) — voir la documentation F08."
    );
  }

  if (!dryRun) {
    return { urlServeur: urlServeurBrute, urlCible: urlServeurBrute };
  }
  const urlEphemere = new URL(urlServeurBrute);
  urlEphemere.pathname = `/${nomBaseEphemere}`;
  return { urlServeur: urlServeurBrute, urlCible: urlEphemere.toString() };
}

async function creerBaseEphemere(urlServeur: string, nomBase: string): Promise<void> {
  const urlMaintenance = new URL(urlServeur);
  urlMaintenance.pathname = "/postgres";
  const prisma = new PrismaClient({ datasources: { db: { url: urlMaintenance.toString() } } });
  try {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${nomBase}"`);
  } finally {
    await prisma.$disconnect();
  }
}

async function supprimerBaseEphemere(urlServeur: string, nomBase: string): Promise<void> {
  const urlMaintenance = new URL(urlServeur);
  urlMaintenance.pathname = "/postgres";
  const prisma = new PrismaClient({ datasources: { db: { url: urlMaintenance.toString() } } });
  try {
    // WITH (FORCE) : coupe les connexions résiduelles (ex. une requête lente pas encore terminée) —
    // la base est jetable par construction, jamais la cible réelle d'une restauration (voir
    // resoudreUrlCible : supprimerBaseEphemere n'est jamais appelée hors du chemin --dry-run).
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`);
  } finally {
    await prisma.$disconnect();
  }
}

// Définition de "vierge" (voir §4 de la conception) : strictement aucune table dans le schéma
// "public" de la base cible. Le test le plus simple possible, impossible à contourner par erreur
// d'inattention (contrairement à un flag qu'on copie-colle sans le lire) — une base de production
// réelle a, par définition, des tables.
export async function verifierCibleVierge(urlCible: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: urlCible } } });
  try {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
    if (tables.length > 0) {
      throw new CibleNonVierge(
        `La base cible contient déjà ${tables.length} table(s) (${tables
          .slice(0, 5)
          .map((t) => t.table_name)
          .join(", ")}${tables.length > 5 ? ", ..." : ""}) — refus absolu de restaurer sur une base non vierge. ` +
          "Aucun contournement n'existe en V1 : provisionnez une nouvelle base PostgreSQL réellement vide."
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

// ============================================================================================
// 4. Chargement des données dans l'ordre topologique, contraintes FK actives, transaction unique.
// ============================================================================================

// Conversion de valeur pilotée par le type RÉEL de la colonne, introspecté dans PostgreSQL (voir
// introspectionSchema.ts) — jamais par le DMMF courant. Seul le cas DateTime a besoin d'une
// conversion explicite (chaîne ISO du JSON -> objet Date) ; les colonnes JSON/JSONB acceptent
// directement un objet JS tel quel (vérifié empiriquement), les colonnes numériques/texte/booléen
// aussi. Decimal/BigInt/Bytes ne sont utilisés par aucun champ du schéma actuel (vérifié :
// `grep -nE "Decimal|BigInt|Bytes" prisma/schema.prisma` ne retourne rien) — cette fonction ne les
// gère donc pas spécifiquement ; à revoir explicitement si un tel champ est introduit un jour.
function convertirValeur(valeur: unknown, colonne: ColonneIntrospectee): unknown {
  if (valeur === null || valeur === undefined) return null;
  if (colonne.estDateTime) return new Date(valeur as string);
  return valeur;
}

// Certaines migrations historiques insèrent elles-mêmes des données (seed de référentiels, backfill
// F11 d'une société par défaut — voir prisma/migrations/20261005170000_.../migration.sql) : au
// moment où cette fonction s'exécute, la base cible a donc DÉJÀ rejoué ces migrations et peut
// contenir des lignes avec les mêmes clés primaires que celles de la sauvegarde (c'est le même
// contenu, produit par la même migration, à deux moments différents — constaté lors des premiers
// essais réels de ce script). D'où un upsert, jamais un simple INSERT : la version de la
// sauvegarde fait foi (elle porte les horodatages réels d'origine, contrairement à une ré-exécution
// de migration qui écrirait CURRENT_TIMESTAMP à l'instant présent).
async function inserer(
  prisma: PrismaClient,
  nomTable: string,
  colonnes: ColonneIntrospectee[],
  cle: string[],
  ligne: Record<string, unknown>
): Promise<void> {
  const colonnesPresentes = colonnes.filter((c) => c.nom in ligne);
  if (colonnesPresentes.length === 0) return;
  const nomsColonnes = colonnesPresentes.map((c) => `"${c.nom}"`).join(", ");
  // Cast explicite ($n::"TypeEnum") pour les colonnes d'énumération : Postgres n'infère jamais
  // automatiquement un type énuméré personnalisé pour un paramètre lié passé comme texte brut
  // (constaté lors des premiers essais réels — "column is of type ... but expression is of type
  // text"), contrairement aux colonnes de types natifs (int, text, timestamp, bool, json/jsonb).
  // udtName (ex. "RoleUtilisateur") préserve la casse exacte du type PostgreSQL — vérifié
  // empiriquement via information_schema.columns.udt_name, cohérent avec les identifiants entre
  // guillemets utilisés par CREATE TYPE dans toutes les migrations de ce projet.
  const placeholders = colonnesPresentes
    .map((c, i) => (c.estEnum ? `$${i + 1}::"${c.udtName}"` : `$${i + 1}`))
    .join(", ");
  const valeurs = colonnesPresentes.map((c) => convertirValeur(ligne[c.nom], c));

  const colonnesHorsCle = colonnesPresentes.filter((c) => !cle.includes(c.nom));
  const clauseConflit = cle.map((c) => `"${c}"`).join(", ");
  const clauseResolution =
    colonnesHorsCle.length > 0
      ? `DO UPDATE SET ${colonnesHorsCle.map((c) => `"${c.nom}" = EXCLUDED."${c.nom}"`).join(", ")}`
      : "DO NOTHING";

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${nomTable}" (${nomsColonnes}) VALUES (${placeholders}) ` +
      `ON CONFLICT (${clauseConflit}) ${clauseResolution}`,
    ...valeurs
  );
}

export type RapportChargement = {
  comptagesParModele: Record<string, { attendu: number; charge: number }>;
};

// Pilotée par le schéma HISTORIQUE réellement introspecté (schema), pas par le DMMF courant — voir
// la note de correctif en tête de ce fichier. graphe est calculé depuis ce même schema (voir
// construireGrapheDepuisIntrospection), donc graphe.ordre ne contient que des tables réellement
// présentes dans schema.tables, y compris une table depuis supprimée du schéma courant (ex.
// AccesApplication).
async function chargerDonnees(
  prisma: PrismaClient,
  enveloppe: EnveloppeSauvegarde,
  schema: SchemaIntrospecte,
  graphe: GrapheRestauration
): Promise<RapportChargement> {
  const comptages: RapportChargement["comptagesParModele"] = {};

  await prisma.$transaction(
    async (tx) => {
      // Passage 1 : toutes les tables dans l'ordre topologique. Pour celles impliquées dans une
      // auto-relation (SousCategorieRecette.parentId), la colonne FK est forcée à NULL à ce stade —
      // voir passage 2 ci-dessous.
      const champsAutoRelation = new Map(graphe.autoRelations.map((r) => [r.modele, r.champFK]));

      for (const nomTable of graphe.ordre) {
        const table = schema.tables.get(nomTable)!;
        const lignes = enveloppe.modeles[nomTable] ?? [];
        const champAutoRelation = champsAutoRelation.get(nomTable);

        let charge = 0;
        for (const ligneBrute of lignes as Record<string, unknown>[]) {
          const ligne = champAutoRelation ? { ...ligneBrute, [champAutoRelation]: null } : ligneBrute;
          await inserer(tx as unknown as PrismaClient, nomTable, table.colonnes, table.clePrimaire, ligne);
          charge++;
        }
        comptages[nomTable] = { attendu: lignes.length, charge };
      }

      // Passage 2 : rétablit les valeurs réelles pour les tables auto-référencées, maintenant que
      // toutes les lignes existent (y compris les enfants eux-mêmes, qui peuvent être leur propre
      // référence indirecte dans une hiérarchie à plusieurs niveaux).
      for (const r of graphe.autoRelations) {
        const lignes = (enveloppe.modeles[r.modele] ?? []) as Record<string, unknown>[];
        const [colonnePk] = schema.tables.get(r.modele)!.clePrimaire;
        for (const ligne of lignes) {
          const valeurFk = ligne[r.champFK];
          if (valeurFk === null || valeurFk === undefined) continue;
          await tx.$executeRawUnsafe(
            `UPDATE "${r.modele}" SET "${r.champFK}" = $1 WHERE "${colonnePk}" = $2`,
            valeurFk,
            ligne[colonnePk]
          );
        }
      }
    },
    { timeout: 10 * 60_000 }
  );

  return { comptagesParModele: comptages };
}

// ============================================================================================
// 5. Vérification d'intégrité post-restauration.
// ============================================================================================

type InvariantSociete = { modele: string; route: string; viaModele: string };

// Calculé dynamiquement depuis le schéma, jamais une liste recopiée à la main (voir §11 de la
// conception) : pour chaque modèle possédant societeId (ou étant Societe lui-même), et chaque
// relation FK menant à un autre modèle qui possède aussi societeId (ou est Societe), c'est un
// chemin vers "la société attendue" pour une ligne donnée. Dès qu'un modèle a deux chemins ou plus
// vers une société (directement + via une relation, ou via deux relations distinctes), ils doivent
// tous s'accorder — sinon c'est précisément le genre d'incohérence inter-société que les
// contraintes FK de PostgreSQL ne détectent jamais (voir le commentaire de SousCategorieRecette
// dans schema.prisma : "vérifié côté route, jamais garanti par le schéma seul").
function detecterInvariantsSociete(): Map<string, InvariantSociete[]> {
  const modeles = Prisma.dmmf.datamodel.models;
  const aSocieteId = new Set(
    modeles.filter((m) => m.fields.some((f) => f.kind === "scalar" && f.name === "societeId")).map((m) => m.name)
  );

  const resultat = new Map<string, InvariantSociete[]>();
  for (const modele of modeles) {
    const routes: InvariantSociete[] = [];
    if (aSocieteId.has(modele.name)) {
      routes.push({ modele: modele.name, route: "societeId", viaModele: "Societe" });
    }
    for (const champ of modele.fields) {
      if (champ.kind !== "object" || !champ.relationFromFields || champ.relationFromFields.length === 0) continue;
      const cible = champ.type;
      if (cible === "Societe") {
        routes.push({ modele: modele.name, route: champ.relationFromFields[0], viaModele: "Societe(direct)" });
      } else if (aSocieteId.has(cible) && cible !== modele.name) {
        routes.push({ modele: modele.name, route: champ.relationFromFields[0], viaModele: cible });
      }
    }
    if (routes.length >= 2) resultat.set(modele.name, routes);
  }
  return resultat;
}

export type ViolationInvariant = { modele: string; idLigne: unknown; details: string };

async function verifierInvariantsSociete(prisma: PrismaClient): Promise<ViolationInvariant[]> {
  const invariants = detecterInvariantsSociete();
  const violations: ViolationInvariant[] = [];

  for (const [nomModele, routes] of invariants) {
    // Deux routes comparées à la fois (ex. societeId direct vs categorieId -> Categorie.societeId) :
    // chaque paire de routes doit résoudre à la même société pour chaque ligne.
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const [a, b] = [routes[i], routes[j]];
        const expr = (r: InvariantSociete) =>
          r.viaModele === "Societe"
            ? `m."${r.route}"`
            : r.viaModele === "Societe(direct)"
              ? `m."${r.route}"`
              : `(SELECT cible."societeId" FROM "${r.viaModele}" cible WHERE cible."id" = m."${r.route}")`;

        const sql = `
          SELECT m."id" AS id_ligne, ${expr(a)} AS route_a, ${expr(b)} AS route_b
          FROM "${nomModele}" m
          WHERE m."${a.route}" IS NOT NULL AND m."${b.route}" IS NOT NULL
            AND ${expr(a)} IS DISTINCT FROM ${expr(b)}
        `;
        const lignes = await prisma.$queryRawUnsafe<{ id_ligne: unknown; route_a: unknown; route_b: unknown }[]>(sql);
        for (const l of lignes) {
          violations.push({
            modele: nomModele,
            idLigne: l.id_ligne,
            details: `${a.route} (société ${l.route_a}) incohérent avec ${b.route} (société ${l.route_b})`,
          });
        }
      }
    }
  }

  return violations;
}

export type RapportFichiersOrphelins = { total: number; orphelins: { fournisseurId: number; cle: string }[] };

// Contrôle des fichiers physiques fournisseurs (voir §12 de la conception) : la base peut être
// restaurée avec succès même si des fichiers sont absents — ce n'est jamais traité comme une
// corruption de la base elle-même, seulement signalé séparément. Aucune tentative de reconstruction
// (impossible sans une sauvegarde séparée des fichiers, hors périmètre dépôt de ce chantier).
async function verifierFichiersFournisseurs(
  documentsFournisseurs: Record<string, unknown>[]
): Promise<RapportFichiersOrphelins | null> {
  const racine = process.env.DOCUMENTS_STORAGE_PATH;
  if (!racine) return null;

  const orphelins: { fournisseurId: number; cle: string }[] = [];
  for (const doc of documentsFournisseurs) {
    const fournisseurId = doc.fournisseurId as number;
    const cle = doc.cle as string;
    const dossier = path.join(racine, "fournisseurs", String(fournisseurId));
    let trouve: boolean;
    try {
      const entrees = await fs.readdir(dossier);
      trouve = entrees.some((e) => e.startsWith(cle));
    } catch {
      trouve = false;
    }
    if (!trouve) orphelins.push({ fournisseurId, cle });
  }
  return { total: documentsFournisseurs.length, orphelins };
}

// ============================================================================================
// 6. Orchestration principale.
// ============================================================================================

export type RapportRestauration = {
  dryRun: boolean;
  fichierSauvegarde: string;
  migrationBackup: string;
  migrationFinaleCible: string;
  migrationFinaleDepot: string;
  chargement: RapportChargement;
  violationsInvariants: ViolationInvariant[];
  fichiersOrphelins: RapportFichiersOrphelins | null;
  sequencesRealignees: RealignementSequence[];
  succes: boolean;
  erreur?: string;
};

export async function restaurer(cheminFichier: string, dryRun: boolean): Promise<RapportRestauration> {
  const enveloppe = await lireEtValiderSauvegarde(cheminFichier);

  // Pré-contrôle rapide, indépendant de ce backup précis : le schéma COURANT du dépôt lui-même ne
  // doit pas avoir de cycle FK non résolu entre modèles distincts. Ne pilote plus le chargement des
  // données (voir plus bas, introspection du schéma historique réellement restauré) — c'est un
  // simple health-check du dépôt, qui échoue avant même de toucher une base.
  const grapheCourant = construireGrapheRestauration();
  if (grapheCourant.cyclesNonResolus.length > 0) {
    throw new ViolationIntegriteError(
      `Cycle(s) FK entre modèles distincts dans le schéma courant du dépôt : ${JSON.stringify(grapheCourant.cyclesNonResolus)}`
    );
  }

  const nomBaseEphemere = `f08_dryrun_${randomUUID().replace(/-/g, "")}`;
  const { urlServeur, urlCible } = resoudreUrlCible(dryRun, nomBaseEphemere);

  if (dryRun) {
    await creerBaseEphemere(urlServeur, nomBaseEphemere);
  } else {
    await verifierCibleVierge(urlCible);
  }

  try {
    // Phase 1 : schéma tel qu'il était au moment de la sauvegarde.
    const dossierPartiel = await construireDossierMigrationsTronque(enveloppe.derniereMigrationAppliquee);
    const resultatPartiel = executerMigrateDeploy(dossierPartiel, urlCible);
    await fs.rm(dossierPartiel, { recursive: true, force: true });
    if (!resultatPartiel.succes) {
      throw new EchecMigrationError(
        `Échec du rejeu des migrations jusqu'à ${enveloppe.derniereMigrationAppliquee} — cible invalide, à jeter :\n${resultatPartiel.sortie}`
      );
    }

    // CORRECTIF : introspection directe du schéma HISTORIQUE tel qu'il vient d'être matérialisé
    // par la phase 1 — jamais le DMMF courant, qui ne connaît plus une table depuis supprimée par
    // une migration ultérieure (ex. AccesApplication). C'est ce schéma introspecté, et le graphe
    // d'ordre d'insertion calculé depuis lui, qui pilotent désormais le chargement des données.
    const prismaIntrospection = new PrismaClient({ datasources: { db: { url: urlCible } } });
    let schemaHistorique: SchemaIntrospecte;
    try {
      schemaHistorique = await introspecterSchema(prismaIntrospection);
    } finally {
      await prismaIntrospection.$disconnect();
    }

    // Vérification de cohérence structure/contenu (voir §9 et §10) : chaque table réellement créée
    // à ce stade doit avoir une clé correspondante dans le JSON (même si vide) — une table absente
    // du JSON alors qu'elle existait à ce point de schéma est un signal de corruption. Faite dans
    // les deux modes (dry-run compris) : un dry-run doit détecter une sauvegarde corrompue tout
    // autant qu'une restauration réelle. Réutilise la liste de tables déjà obtenue par
    // l'introspection ci-dessus, jamais une seconde requête PostgreSQL redondante.
    verifierCoherenceTablesModeles([...schemaHistorique.tables.keys()], enveloppe);

    // Graphe d'ordre d'insertion calculé depuis CE schéma historique réel, pas depuis le DMMF
    // courant — peut différer du graphe courant si le schéma a évolué depuis (ex. une table
    // depuis supprimée, ou une relation FK depuis modifiée).
    const grapheHistorique = construireGrapheDepuisIntrospection(schemaHistorique);
    if (grapheHistorique.cyclesNonResolus.length > 0) {
      throw new ViolationIntegriteError(
        `Cycle(s) FK entre tables distinctes dans le schéma historique restauré : ${JSON.stringify(grapheHistorique.cyclesNonResolus)}`
      );
    }

    // Chargement des données, dans l'état de schéma du backup.
    const prismaCible = new PrismaClient({ datasources: { db: { url: urlCible } } });
    let chargement: RapportChargement;
    try {
      chargement = await chargerDonnees(prismaCible, enveloppe, schemaHistorique, grapheHistorique);
    } finally {
      await prismaCible.$disconnect();
    }

    // Phase 2 : rattrapage jusqu'au schéma courant du dépôt.
    const dossierComplet = await construireDossierMigrationsTronque(null);
    // null = dossier complet (toutes les migrations réelles), voir construireDossierMigrationsTronque.
    const resultatComplet = executerMigrateDeploy(dossierComplet, urlCible);
    await fs.rm(dossierComplet, { recursive: true, force: true });
    if (!resultatComplet.succes) {
      throw new EchecMigrationError(
        `Échec du rattrapage des migrations vers le schéma courant — cible invalide, à jeter :\n${resultatComplet.sortie}`
      );
    }

    // Réalignement des séquences PostgreSQL (correctif suite à un second audit indépendant) :
    // obligatoirement APRÈS le rattrapage complet vers le schéma courant ci-dessus, jamais avant —
    // une migration rejouée pendant le rattrapage peut elle-même insérer/supprimer/transformer des
    // lignes et donc changer le MAX(id) réel d'une table ; le calcul doit porter sur l'état FINAL
    // de la base restaurée, pas sur l'état intermédiaire issu du seul chargement du backup. Avant
    // ce réalignement, un INSERT automatique suivant la restauration pouvait réutiliser un ID déjà
    // restauré (violation de contrainte unique) — voir prisma/utils/realignementSequences.ts.
    const prismaSequences = new PrismaClient({ datasources: { db: { url: urlCible } } });
    let sequencesRealignees: RealignementSequence[];
    try {
      sequencesRealignees = await realignerSequences(prismaSequences);
    } finally {
      await prismaSequences.$disconnect();
    }

    // Vérification d'intégrité.
    const prismaVerif = new PrismaClient({ datasources: { db: { url: urlCible } } });
    let migrationFinaleCible: string;
    let violationsInvariants: ViolationInvariant[];
    let fichiersOrphelins: RapportFichiersOrphelins | null;
    try {
      migrationFinaleCible = await derniereMigrationAppliquee(prismaVerif);
      violationsInvariants = await verifierInvariantsSociete(prismaVerif);
      fichiersOrphelins = await verifierFichiersFournisseurs(
        (enveloppe.modeles.DocumentFournisseur ?? []) as Record<string, unknown>[]
      );
    } finally {
      await prismaVerif.$disconnect();
    }

    const migrationsReelles = await listerDossiersMigrations(DOSSIER_MIGRATIONS_REEL);
    const migrationFinaleDepot = migrationsReelles[migrationsReelles.length - 1];

    const comptagesIncoherents = Object.entries(chargement.comptagesParModele).filter(
      ([, c]) => c.attendu !== c.charge
    );

    const succes =
      comptagesIncoherents.length === 0 &&
      migrationFinaleCible === migrationFinaleDepot &&
      violationsInvariants.length === 0;

    return {
      dryRun,
      fichierSauvegarde: cheminFichier,
      migrationBackup: enveloppe.derniereMigrationAppliquee,
      migrationFinaleCible,
      migrationFinaleDepot,
      chargement,
      violationsInvariants,
      fichiersOrphelins,
      sequencesRealignees,
      succes,
    };
  } finally {
    if (dryRun) {
      await supprimerBaseEphemere(urlServeur, nomBaseEphemere);
    }
  }
}

// Pure : réutilise la liste de tables déjà obtenue par introspecterSchema (voir restaurer()) —
// jamais une seconde requête PostgreSQL redondante pour la même information.
function verifierCoherenceTablesModeles(nomsTables: string[], enveloppe: EnveloppeSauvegarde): void {
  const manquantes = nomsTables.filter((nom) => !(nom in enveloppe.modeles));
  if (manquantes.length > 0) {
    throw new SauvegardeInvalideError(
      `Sauvegarde incohérente : ${manquantes.length} table(s) existaient au schéma déclaré ` +
        `(${enveloppe.derniereMigrationAppliquee}) mais sont absentes du JSON : ` +
        `${manquantes.join(", ")}. Fichier corrompu ou modifié à la main — refus.`
    );
  }
}

// ============================================================================================
// Point d'entrée CLI.
// ============================================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const cheminFichier = args.find((a) => !a.startsWith("--"));

  if (!cheminFichier) {
    console.error("Usage : npx tsx prisma/restaurer.ts <fichier-sauvegarde.json> [--dry-run]");
    process.exit(1);
  }

  console.log(`${dryRun ? "[DRY-RUN] " : ""}Restauration de ${cheminFichier}...`);

  try {
    const rapport = await restaurer(path.resolve(cheminFichier), dryRun);

    console.log("\n=== Rapport de restauration ===");
    console.log(`Migration du backup       : ${rapport.migrationBackup}`);
    console.log(`Migration finale (cible)   : ${rapport.migrationFinaleCible}`);
    console.log(`Migration finale (dépôt)   : ${rapport.migrationFinaleDepot}`);
    console.log("\nComptages par modèle (attendu vs chargé) :");
    for (const [modele, c] of Object.entries(rapport.chargement.comptagesParModele)) {
      const marqueur = c.attendu === c.charge ? "OK" : "ÉCART";
      if (c.attendu > 0 || c.attendu !== c.charge) {
        console.log(`  ${marqueur.padEnd(6)} ${modele}: ${c.charge}/${c.attendu}`);
      }
    }
    if (rapport.violationsInvariants.length > 0) {
      console.log(`\n⚠ ${rapport.violationsInvariants.length} violation(s) d'invariant multi-société :`);
      for (const v of rapport.violationsInvariants.slice(0, 20)) {
        console.log(`  ${v.modele}#${String(v.idLigne)} : ${v.details}`);
      }
    } else {
      console.log("\nInvariants multi-société : OK (aucune violation)");
    }
    if (rapport.fichiersOrphelins) {
      const { total, orphelins } = rapport.fichiersOrphelins;
      console.log(
        `\nFichiers fournisseurs : ${total - orphelins.length}/${total} présents` +
          (orphelins.length > 0 ? ` — ${orphelins.length} orphelin(s) (base restaurée, documents incomplets)` : "")
      );
    }
    console.log(`\nSéquences PostgreSQL réalignées : ${rapport.sequencesRealignees.length}`);

    console.log(`\n${rapport.succes ? "✅ RESTAURATION RÉUSSIE" : "❌ RESTAURATION EN ÉCHEC"}`);
    if (!rapport.dryRun && rapport.succes) {
      console.log(
        "\nLa base cible est restaurée et validée. Bascule manuelle de DATABASE_URL requise — " +
          "ce script ne la fait jamais lui-même. Validation humaine avant bascule recommandée."
      );
    }
    process.exit(rapport.succes ? 0 : 1);
  } catch (erreur) {
    console.error(`\n❌ ÉCHEC : ${(erreur as Error).message}`);
    console.error(
      "\nAucune restauration partielle n'est considérée réussie. Si une base cible a été créée, " +
        "elle est invalide et doit être jetée — ne jamais tenter de la réutiliser ou de la réparer."
    );
    process.exit(1);
  }
}

// Contrairement à prisma/sauvegarder.ts (main() inconditionnel, testé exclusivement via
// spawnSync — voir tests/unit/sauvegarderScript.test.ts), ce fichier exporte de nombreuses
// fonctions destinées à être testées unitairement par import direct (validation du format,
// résolution d'URL cible, etc.), sans déclencher pour autant une vraie restauration à chaque
// import. D'où ce garde d'entrée, équivalent ESM de `require.main === module` : main() ne
// s'exécute que si ce fichier est lancé directement (`npx tsx prisma/restaurer.ts ...`), jamais
// lors d'un `import` depuis un fichier de test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
