// F08 de l'audit forensique — correctif suite à un second audit indépendant : chargerDonnees()
// (voir prisma/restaurer.ts) insère les lignes avec leurs IDs explicites issus du backup, via
// upsert, pour toutes les colonnes `Int @id @default(autoincrement())` du schéma (34 modèles à ce
// jour) — mais ne touche jamais aux séquences PostgreSQL qui génèrent les IDs automatiques d'un
// futur INSERT sans ID explicite. Une séquence fraîchement migrée démarre à 1 et n'est avancée que
// par les migrations qui insèrent elles-mêmes des lignes sans ID explicite (seeds de référentiels) —
// jamais par un chargement de backup. Sans réalignement, le premier INSERT automatique suivant une
// restauration réutilise un ID déjà restauré (violation de contrainte unique) — reproduit par un
// test dédié avant correction (voir tests/unit/restaurerScript.test.ts, scénario "séquences
// PostgreSQL").
//
// Générique, piloté par introspection — jamais une liste de tables codée en dur : découvre toute
// colonne réellement adossée à une séquence PostgreSQL via `column_default LIKE 'nextval(%'` (la
// façon dont une colonne SERIAL se déclare), résout le nom réel de sa séquence via
// `pg_get_serial_sequence()` (jamais une supposition sur la convention de nommage Prisma
// `"Table_colonne_seq"`, même si elle s'avère exacte ici), puis réaligne via `setval()` sur le
// MAX() réel de la colonne. Une table vide n'est jamais touchée : sa séquence, fraîchement migrée,
// démarre déjà correctement à 1.
//
// Ce projet n'utilise que SERIAL pour les colonnes auto-incrémentées (vérifié : zéro colonne
// `GENERATED ... AS IDENTITY` dans tout l'historique des migrations). Une colonne IDENTITY ne
// déclare pas de `column_default` de la forme `nextval(...)` et ne serait donc pas couverte par ce
// mécanisme — elle nécessiterait `ALTER TABLE ... ALTER COLUMN ... RESTART WITH`, non implémenté
// ici, hors périmètre tant qu'aucun cas réel n'existe (voir docs/sauvegarde-restauration.md).

import type { PrismaClient } from "@prisma/client";

export type RealignementSequence = {
  table: string;
  colonne: string;
  sequence: string;
  valeur: number;
};

export async function realignerSequences(prisma: PrismaClient): Promise<RealignementSequence[]> {
  const colonnesSerial = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'
  `;

  const resultats: RealignementSequence[] = [];
  for (const { table_name, column_name } of colonnesSerial) {
    const [{ seq: sequence }] = await prisma.$queryRawUnsafe<{ seq: string | null }[]>(
      `SELECT pg_get_serial_sequence($1, $2) AS seq`,
      `"${table_name}"`,
      column_name
    );
    // Prudence : une colonne au défaut en forme de nextval(...) mais sans séquence réellement liée
    // (cas non attendu avec SERIAL) ne doit jamais faire échouer la restauration pour autant.
    if (!sequence) continue;

    const [{ max }] = await prisma.$queryRawUnsafe<{ max: number | null }[]>(
      `SELECT MAX("${column_name}") AS max FROM "${table_name}"`
    );
    if (max === null) continue; // table vide : la séquence, fraîchement migrée, est déjà correcte.

    await prisma.$executeRawUnsafe(`SELECT setval($1, $2, true)`, sequence, max);
    resultats.push({ table: table_name, colonne: column_name, sequence, valeur: max });
  }
  return resultats;
}
