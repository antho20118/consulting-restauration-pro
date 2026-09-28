// Script de rattrapage ponctuel : attribue un codeFournisseur (voir genererCodeFournisseur,
// server/routes/fournisseurs.ts) à tout Fournisseur existant qui n'en a pas — que ce soit un
// fournisseur d'avant le chantier « identité fournisseur » (jamais concerné à l'origine, voir le
// commentaire du champ dans schema.prisma), ou un fournisseur créé automatiquement pendant un
// import listing avant la correction de trouverOuCreerFournisseur (server/routes/articles.ts), qui
// ne générait pas encore ce code.
//
// Idempotent : ne touche que les lignes où codeFournisseur est encore null, une seconde exécution
// ne fait donc rien. Traité société par société, dans l'ordre de création (id croissant), une
// transaction par fournisseur : le compteur atomique (SocieteCompteur) et l'assignation du code
// réussissent ou échouent ensemble, jamais de code "perdu" en cas d'erreur sur une ligne — les
// autres fournisseurs continuent d'être traités.
//
// Usage : npx tsx prisma/backfillCodeFournisseur.ts

import { PrismaClient } from "@prisma/client";
import { genererCodeFournisseur } from "../server/routes/fournisseurs.js";

const prisma = new PrismaClient();

async function main() {
  const fournisseursSansCode = await prisma.fournisseur.findMany({
    where: { codeFournisseur: null },
    select: { id: true, nom: true, societeId: true },
    orderBy: { id: "asc" },
  });

  if (fournisseursSansCode.length === 0) {
    console.log("✅ Aucun fournisseur sans code — rien à rattraper.");
    return;
  }

  console.log(`${fournisseursSansCode.length} fournisseur(s) sans codeFournisseur trouvé(s).`);

  let traites = 0;
  let echecs = 0;
  for (const f of fournisseursSansCode) {
    try {
      const code = await prisma.$transaction(async (tx) => {
        const genere = await genererCodeFournisseur(tx, f.societeId);
        await tx.fournisseur.update({ where: { id: f.id }, data: { codeFournisseur: genere } });
        return genere;
      });
      console.log(`  #${f.id} "${f.nom}" -> ${code}`);
      traites++;
    } catch (error) {
      console.error(`  #${f.id} "${f.nom}" : échec —`, error instanceof Error ? error.message : error);
      echecs++;
    }
  }

  console.log(`✅ ${traites} fournisseur(s) mis à jour.${echecs > 0 ? ` ⚠ ${echecs} échec(s).` : ""}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
