// Active (ou retire) le flag superAdmin sur un compte existant (voir le commentaire du champ dans
// schema.prisma et server/middleware/requireSuperAdmin.ts) — jamais fait depuis l'interface, pour
// qu'aucun compte client (même PROPRIETAIRE de sa société) ne puisse se l'accorder lui-même.
//
// Usage : npx tsx prisma/definirSuperAdmin.ts <identifiant> [--retirer]

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [identifiant, ...reste] = process.argv.slice(2);
  if (!identifiant) {
    console.error("Usage : npx tsx prisma/definirSuperAdmin.ts <identifiant> [--retirer]");
    process.exit(1);
  }
  const superAdmin = !reste.includes("--retirer");

  const utilisateur = await prisma.utilisateur.findUnique({ where: { identifiant } });
  if (!utilisateur) {
    console.error(`Aucun compte avec l'identifiant "${identifiant}".`);
    process.exit(1);
  }

  await prisma.utilisateur.update({ where: { id: utilisateur.id }, data: { superAdmin } });
  console.log(
    `✅ superAdmin ${superAdmin ? "activé" : "retiré"} pour "${identifiant}" (compte #${utilisateur.id}).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
