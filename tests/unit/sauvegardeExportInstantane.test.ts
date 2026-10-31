import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import prisma from "../../server/prisma.js";
import { exporterBase, dansInstantaneLectureSeule } from "../../server/utils/sauvegardeExterne/exportBase.js";

// Export de la base pour les sauvegardes (manuelle et automatique, voir exportBase.ts) : il lisait
// les tables l'une après l'autre, chacune à un instant différent. Une saisie arrivée pendant
// l'export (synchronisation hors ligne à 3 h du matin, par exemple) pouvait y figurer à moitié — une
// ligne présente sans celle qu'elle référence — et la sauvegarde n'était alors plus restaurable.
// Désormais : toutes les tables lues dans UNE transaction PostgreSQL figée (REPEATABLE READ) et en
// lecture seule — jamais une écriture possible sur la base de production pendant l'export.

const autreConnexion = new PrismaClient();
const marqueur = `INSTANTANE-${randomUUID()}`;

after(async () => {
  await prisma.journalErreur.deleteMany({ where: { message: marqueur } });
  await autreConnexion.$disconnect();
  await prisma.$disconnect();
});

test("une écriture arrivée pendant l'export n'y figure jamais : toutes les tables lues au même instant", async () => {
  let ecrite = false;
  const enveloppe = await exporterBase(prisma, new Date(), {
    // Juste après la lecture de la PREMIÈRE table, une autre connexion écrit dans la DERNIÈRE.
    apresLectureTable: async () => {
      if (ecrite) return;
      ecrite = true;
      await autreConnexion.journalErreur.create({ data: { origine: "SERVEUR", message: marqueur } });
    },
  });
  assert.equal(ecrite, true);
  const lignes = enveloppe.modeles.JournalErreur as { message: string }[];
  assert.equal(lignes.filter((l) => l.message === marqueur).length, 0, "la ligne écrite après le début de l'export ne doit pas y figurer");
  assert.equal(await prisma.journalErreur.count({ where: { message: marqueur } }), 1, "témoin : l'écriture a bien eu lieu");
});

test("transaction de l'export en lecture seule : toute écriture y est refusée par PostgreSQL", async () => {
  await assert.rejects(
    dansInstantaneLectureSeule(prisma, (tx) => tx.journalErreur.create({ data: { origine: "SERVEUR", message: marqueur } })),
    /read-only transaction/
  );
  assert.equal(await prisma.journalErreur.count({ where: { message: marqueur } }), 1, "aucune ligne de plus");
});
