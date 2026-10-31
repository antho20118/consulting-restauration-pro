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
// recopiée à la main qui pourrait oublier un modèle ajouté plus tard (voir exporterBase).
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
import { PrismaClient } from "@prisma/client";
import { racineStockage } from "../server/utils/storageDocumentsFournisseur.js";
import { exporterBase } from "../server/utils/sauvegardeExterne/exportBase.js";

const prisma = new PrismaClient();

async function main() {
  const dossierSauvegardes = path.join(racineStockage(), "sauvegardes");
  await fs.mkdir(dossierSauvegardes, { recursive: true });

  // Même export que la sauvegarde automatique hors de Railway (voir server/utils/sauvegardeExterne/).
  const enveloppe = await exporterBase(prisma);

  const horodatage = enveloppe.creeLe.replace(/[:.]/g, "-");
  const nomFichier = `sauvegarde-${horodatage}.json`;
  const cheminFichier = path.join(dossierSauvegardes, nomFichier);
  await fs.writeFile(cheminFichier, JSON.stringify(enveloppe, null, 2), "utf8");

  console.log(`✅ Sauvegarde écrite : ${cheminFichier}`);
  console.log(`  formatVersion: ${enveloppe.formatVersion}`);
  console.log(`  derniereMigrationAppliquee: ${enveloppe.derniereMigrationAppliquee}`);
  for (const [nomModele, lignes] of Object.entries(enveloppe.modeles)) {
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
