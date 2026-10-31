import { Prisma, type PrismaClient } from "@prisma/client";
import { derniereMigrationAppliquee } from "../../../prisma/utils/migrationsAppliquees.js";

// Export complet de la base au format versionné restaurable par prisma/restaurer.ts (F08 de l'audit
// forensique, voir docs/sauvegarde-restauration.md) — une seule implémentation, partagée par la
// sauvegarde manuelle (prisma/sauvegarder.ts) et la sauvegarde automatique hors de Railway
// (sauvegardeExterne.ts). Liste des tables lue depuis le schéma Prisma lui-même (Prisma.dmmf),
// jamais recopiée à la main.

export const FORMAT_VERSION = 1;

export type EnveloppeExport = {
  formatVersion: number;
  creeLe: string;
  derniereMigrationAppliquee: string;
  modeles: Record<string, unknown[]>;
};

type AccesseurModele = { findMany: () => Promise<unknown[]> };

// Délai maximal de l'export entier : large, pour une base qui grandit (photos des plats en base64).
const DUREE_MAX_EXPORT_MS = 10 * 60_000;

// Toutes les lectures dans UNE transaction PostgreSQL figée (REPEATABLE READ : chaque requête voit
// la base telle qu'au début de la transaction) et en lecture seule (READ ONLY : PostgreSQL refuse
// toute écriture). Jusqu'ici, les tables étaient lues l'une après l'autre, chacune à un instant
// différent : une saisie arrivée pendant l'export pouvait y figurer à moitié, et la sauvegarde
// n'était plus restaurable.
export function dansInstantaneLectureSeule<T>(prisma: PrismaClient, travail: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return travail(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: DUREE_MAX_EXPORT_MS, maxWait: 30_000 }
  );
}

export async function exporterBase(
  prisma: PrismaClient,
  creeLe = new Date(),
  // Réservé aux tests (voir sauvegardeExportInstantane.test.ts) : appelé après chaque table lue.
  options: { apresLectureTable?: (modele: string) => Promise<void> } = {}
): Promise<EnveloppeExport> {
  return dansInstantaneLectureSeule(prisma, async (tx) => {
    const client = tx as unknown as Record<string, AccesseurModele>;
    const modeles: Record<string, unknown[]> = {};
    for (const { name } of Prisma.dmmf.datamodel.models) {
      modeles[name] = await client[name.charAt(0).toLowerCase() + name.slice(1)].findMany();
      await options.apresLectureTable?.(name);
    }
    return {
      formatVersion: FORMAT_VERSION,
      creeLe: creeLe.toISOString(),
      derniereMigrationAppliquee: await derniereMigrationAppliquee(tx as PrismaClient),
      modeles,
    };
  });
}
