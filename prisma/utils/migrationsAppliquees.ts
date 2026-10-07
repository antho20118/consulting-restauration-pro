// F08 de l'audit forensique : détermine la dernière migration réellement appliquée à une base, en
// lisant directement "_prisma_migrations" (la table interne que Prisma lui-même utilise pour savoir
// quoi appliquer — voir "prisma migrate status") — jamais déduite du schema.prisma courant ni d'un
// nom de fichier arbitraire, qui pourraient diverger de l'état réel d'une base donnée.

import { PrismaClient } from "@prisma/client";

export class AucuneMigrationAppliqueeError extends Error {}

type LigneMigration = { migration_name: string };

// "terminee" : finished_at renseigné ET rolled_back_at absent — une migration en échec ou annulée
// ne compte jamais comme appliquée (voir la doc Prisma sur la résolution d'incidents de migration,
// référencée dans le message d'erreur P3018 qu'on a rencontré en CI sur F11).
export async function derniereMigrationAppliquee(prisma: PrismaClient): Promise<string> {
  const lignes = await prisma.$queryRaw<LigneMigration[]>`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at DESC
    LIMIT 1
  `;

  if (lignes.length === 0) {
    throw new AucuneMigrationAppliqueeError(
      "Aucune migration appliquée trouvée dans _prisma_migrations : base non initialisée, ou historique de migration corrompu."
    );
  }

  return lignes[0].migration_name;
}

// Toutes les migrations réellement et proprement appliquées (terminee=true), dans l'ordre
// d'application — utilisé par restaurer.ts pour distinguer "migration connue mais jamais appliquée
// proprement sur CETTE base" d'une simple absence.
export async function migrationsAppliquees(prisma: PrismaClient): Promise<string[]> {
  const lignes = await prisma.$queryRaw<LigneMigration[]>`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at ASC
  `;
  return lignes.map((l) => l.migration_name);
}
