// Sauvegarde manuelle complète de la base : exporte chaque table en JSON sur le volume Railway
// persistant déjà attaché au service (DOCUMENTS_STORAGE_PATH, voir
// server/utils/storageDocumentsFournisseur.ts), sous un sous-dossier "sauvegardes" — jamais sur le
// disque éphémère du conteneur, qui serait perdu au prochain redéploiement.
//
// Solution provisoire en attendant le plan Railway Pro (sauvegardes + PITR automatiques) : ce
// fichier reste sur Railway, donc ne protège pas contre un incident sur Railway lui-même — mais
// protège contre une erreur de manipulation ou un bug applicatif qui corromprait les données.
// Le fichier peut ensuite être téléchargé depuis l'application (voir GET /api/sauvegardes) pour
// être stocké ailleurs.
//
// Liste des tables obtenue depuis le schéma Prisma lui-même (Prisma.dmmf), jamais une liste
// recopiée à la main qui pourrait oublier un modèle ajouté plus tard.
//
// Format versionné (F08 de l'audit forensique, phase 2) : l'enveloppe porte formatVersion (version
// de la forme du fichier lui-même) et derniereMigrationAppliquee (lue depuis _prisma_migrations,
// jamais déduite du schema.prisma courant) — c'est ce dernier champ qui permet à
// prisma/restaurer.ts de faire évoluer une ancienne sauvegarde jusqu'au schéma courant en rejouant
// les vraies migrations, plutôt que d'exiger un format figé pour toujours. Voir la conception F08
// phase 2 pour le raisonnement complet.
//
// Usage : npx tsx prisma/sauvegarder.ts

import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { racineStockage } from "../server/utils/storageDocumentsFournisseur.js";
import { derniereMigrationAppliquee } from "./utils/migrationsAppliquees.js";

const prisma = new PrismaClient();

const FORMAT_VERSION = 1;

type AccesseurModele = { findMany: () => Promise<unknown[]> };

async function main() {
  const dossierSauvegardes = path.join(racineStockage(), "sauvegardes");
  await fs.mkdir(dossierSauvegardes, { recursive: true });

  const nomsModeles = Prisma.dmmf.datamodel.models.map((m) => m.name);
  const client = prisma as unknown as Record<string, AccesseurModele>;

  const modeles: Record<string, unknown[]> = {};
  for (const nomModele of nomsModeles) {
    const accesseur = nomModele.charAt(0).toLowerCase() + nomModele.slice(1);
    modeles[nomModele] = await client[accesseur].findMany();
  }

  const migration = await derniereMigrationAppliquee(prisma);
  const creeLe = new Date().toISOString();
  const enveloppe = { formatVersion: FORMAT_VERSION, creeLe, derniereMigrationAppliquee: migration, modeles };

  const horodatage = creeLe.replace(/[:.]/g, "-");
  const nomFichier = `sauvegarde-${horodatage}.json`;
  const cheminFichier = path.join(dossierSauvegardes, nomFichier);
  await fs.writeFile(cheminFichier, JSON.stringify(enveloppe, null, 2), "utf8");

  console.log(`✅ Sauvegarde écrite : ${cheminFichier}`);
  console.log(`  formatVersion: ${FORMAT_VERSION}`);
  console.log(`  derniereMigrationAppliquee: ${migration}`);
  for (const [nomModele, lignes] of Object.entries(modeles)) {
    console.log(`  ${nomModele}: ${lignes.length} ligne(s)`);
  }
  console.log(`\nTéléchargement : GET /api/sauvegardes/${nomFichier} (jeton requis, voir la page Paramètres).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
