// F08 de l'audit forensique — correctif suite à l'audit indépendant : le chargement d'une
// sauvegarde historique ne doit plus dépendre du schéma Prisma COURANT (Prisma.dmmf), qui ne
// connaît plus les modèles/tables supprimés par une migration ultérieure (cas réel connu :
// AccesApplication, supprimée par 20260930090000_utilisateurs_roles — voir prisma/restaurer.ts).
//
// Cette fonction interroge PostgreSQL lui-même, juste après que la phase 1 de restaurer.ts a amené
// la base cible au schéma HISTORIQUE exact du backup (migrations rejouées jusqu'à
// derniereMigrationAppliquee) : elle voit donc réellement les tables telles qu'elles existaient à
// cet instant précis, y compris celles qui seront supprimées par une migration ultérieure rejouée
// en phase 2. C'est cette introspection — jamais le DMMF courant — qui pilote désormais le
// chargement des données historiques (voir chargerDonnees dans restaurer.ts).
//
// Correspondance nom de modèle Prisma <-> nom de table PostgreSQL : aucun mécanisme @map/@@map
// n'est utilisé dans ce projet (vérifié : zéro occurrence dans prisma/schema.prisma, à n'importe
// quel point de son historique — les migrations sont écrites à la main en SQL, sans générateur
// Prisma intermédiaire, et respectent cette convention depuis la toute première migration). Le nom
// de table est donc toujours strictement identique au nom de modèle, et le nom de colonne toujours
// strictement identique au nom de champ. C'est pourquoi les clés de enveloppe.modeles (qui sont
// déjà des noms de table réels, voir prisma/sauvegarder.ts) sont directement utilisables comme noms
// de table SQL ici, sans couche de correspondance additionnelle. Si ce projet introduit un jour
// @map/@@map, cette hypothèse devient fausse et cette fonction (ainsi que sauvegarder.ts) doivent
// être revus avant toute nouvelle restauration historique — voir le rapport correctif F08.

import type { PrismaClient } from "@prisma/client";

export type ColonneIntrospectee = {
  nom: string;
  dataType: string;
  udtName: string;
  estEnum: boolean;
  estDateTime: boolean;
  nullable: boolean;
};

export type TableIntrospectee = {
  nom: string;
  colonnes: ColonneIntrospectee[];
  clePrimaire: string[];
};

export type RelationFKIntrospectee = {
  table: string;
  colonne: string;
  tableCible: string;
  optionnelle: boolean;
};

export type SchemaIntrospecte = {
  tables: Map<string, TableIntrospectee>;
  relations: RelationFKIntrospectee[];
};

// Types PostgreSQL correspondant à un DateTime Prisma — nécessitent une conversion en objet Date
// avant insertion (voir convertirValeur dans restaurer.ts), jamais une chaîne brute.
const TYPES_DATETIME = new Set([
  "timestamp without time zone",
  "timestamp with time zone",
  "date",
  "time without time zone",
  "time with time zone",
]);

export async function introspecterSchema(prisma: PrismaClient): Promise<SchemaIntrospecte> {
  const nomsTables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name NOT LIKE '\\_prisma%'
  `;

  const tables = new Map<string, TableIntrospectee>();
  for (const { table_name } of nomsTables) {
    const colonnesBrutes = await prisma.$queryRawUnsafe<
      { column_name: string; data_type: string; udt_name: string; is_nullable: string }[]
    >(
      `SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      table_name
    );

    const clePrimaireBrute = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
      table_name
    );

    // Les 36 tables du schéma courant déclarent toutes une clé primaire (vérifié empiriquement),
    // et chaque migration historique créant une table le fait dès le CREATE TABLE (jamais ajoutée
    // après coup) — mais on échoue explicitement plutôt que de deviner si ce n'était pas le cas,
    // cohérent avec le principe général de F08 (jamais de restauration sur une incertitude).
    if (clePrimaireBrute.length === 0) {
      throw new Error(
        `Table "${table_name}" sans clé primaire identifiable dans le schéma historique restauré — restauration impossible.`
      );
    }

    tables.set(table_name, {
      nom: table_name,
      colonnes: colonnesBrutes.map((c) => ({
        nom: c.column_name,
        dataType: c.data_type,
        udtName: c.udt_name,
        estEnum: c.data_type === "USER-DEFINED",
        estDateTime: TYPES_DATETIME.has(c.data_type),
        nullable: c.is_nullable === "YES",
      })),
      clePrimaire: clePrimaireBrute.map((k) => k.column_name),
    });
  }

  const relationsBrutes = await prisma.$queryRaw<
    { table_source: string; colonne_fk: string; table_cible: string }[]
  >`
    SELECT tc.table_name AS table_source, kcu.column_name AS colonne_fk, ccu.table_name AS table_cible
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
  `;

  const relations: RelationFKIntrospectee[] = relationsBrutes.map((r) => {
    const colonne = tables.get(r.table_source)?.colonnes.find((c) => c.nom === r.colonne_fk);
    return {
      table: r.table_source,
      colonne: r.colonne_fk,
      tableCible: r.table_cible,
      optionnelle: colonne?.nullable ?? true,
    };
  });

  return { tables, relations };
}
