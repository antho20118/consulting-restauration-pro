import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient, Prisma } from "@prisma/client";
import { introspecterSchema } from "../../prisma/utils/introspectionSchema.js";
import { construireGrapheDepuisIntrospection } from "../../prisma/utils/grapheIntrospection.js";
import { construireDossierMigrationsTronque } from "../../prisma/restaurer.js";
import fs from "node:fs/promises";

// F08 de l'audit forensique, correctif suite à l'audit indépendant : test de non-régression
// GÉNÉRIQUE (section 10 de la demande de correction) — prouve, au niveau du module
// d'introspection lui-même (pas au niveau de l'intégration complète restaurer(), déjà couverte par
// tests/unit/restaurerScript.test.ts), qu'une table présente dans un schéma HISTORIQUE mais absente
// du DMMF Prisma courant est malgré tout découverte et correctement intégrée au graphe d'ordre
// d'insertion. AccesApplication est réutilisée ici comme SEUL cas réel disponible dans
// l'historique de migrations de ce projet (vérifié : `grep -rl "DROP TABLE" prisma/migrations/`
// ne retourne que 20260930090000_utilisateurs_roles) — mais le code testé
// (introspecterSchema/construireGrapheDepuisIntrospection) ne contient aucune mention de ce nom de
// table : il fonctionnerait identiquement pour n'importe quelle autre table disparue du schéma
// courant.

function urlServeur(): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = "/postgres";
  return u.toString();
}

function urlBase(nom: string): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${nom}`;
  return u.toString();
}

const basesACreer: string[] = [];
let urlHistorique: string;

before(async () => {
  const nom = `f08_introspect_generic_${randomUUID().replace(/-/g, "")}`;
  const prismaCreation = new PrismaClient({ datasources: { db: { url: urlServeur() } } });
  try {
    await prismaCreation.$executeRawUnsafe(`CREATE DATABASE "${nom}"`);
  } finally {
    await prismaCreation.$disconnect();
  }
  basesACreer.push(nom);
  urlHistorique = urlBase(nom);

  // Migre uniquement jusqu'à un point antérieur à la suppression d'AccesApplication — en
  // réutilisant la même fonction que restaurer() lui-même (jamais une reconstruction parallèle).
  const dossierTronque = await construireDossierMigrationsTronque("20260929210000_productions_haccp_datee");
  try {
    const resultat = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: dossierTronque,
      env: { ...process.env, DATABASE_URL: urlHistorique },
      encoding: "utf8",
    });
    assert.equal(resultat.status, 0, `migrate deploy tronqué a échoué : ${resultat.stderr}`);
  } finally {
    await fs.rm(dossierTronque, { recursive: true, force: true });
  }
});

after(async () => {
  const prismaSuppression = new PrismaClient({ datasources: { db: { url: urlServeur() } } });
  try {
    for (const nom of basesACreer) {
      await prismaSuppression.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nom}" WITH (FORCE)`);
    }
  } finally {
    await prismaSuppression.$disconnect();
  }
});

test("PREUVE DE GÉNÉRICITÉ : introspecterSchema découvre une table absente du DMMF Prisma courant", async () => {
  // Confirme d'abord la prémisse du test : AccesApplication n'existe plus dans le DMMF courant
  // (sinon ce test ne prouverait rien — voir le même raisonnement dans le test de provenance).
  const presenteDansDmmf = Prisma.dmmf.datamodel.models.some((m) => m.name === "AccesApplication");
  assert.equal(presenteDansDmmf, false, "AccesApplication ne doit plus être un modèle du DMMF courant");

  const prisma = new PrismaClient({ datasources: { db: { url: urlHistorique } } });
  try {
    const schema = await introspecterSchema(prisma);

    assert.ok(
      schema.tables.has("AccesApplication"),
      "introspecterSchema doit découvrir une table historique absente du DMMF courant"
    );

    const table = schema.tables.get("AccesApplication")!;
    const nomsColonnes = table.colonnes.map((c) => c.nom).sort();
    assert.deepEqual(nomsColonnes, ["codeHache", "id", "identifiant", "updatedAt"]);
    assert.deepEqual(table.clePrimaire, ["id"]);
  } finally {
    await prisma.$disconnect();
  }
});

test("PREUVE DE GÉNÉRICITÉ : construireGrapheDepuisIntrospection intègre correctement une table absente du DMMF courant dans l'ordre d'insertion", async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: urlHistorique } } });
  try {
    const schema = await introspecterSchema(prisma);
    const graphe = construireGrapheDepuisIntrospection(schema);

    assert.ok(graphe.ordre.includes("AccesApplication"), "AccesApplication doit apparaître dans l'ordre d'insertion calculé");
    assert.equal(graphe.ordre.length, schema.tables.size, "chaque table du schéma historique doit apparaître exactement une fois");
    assert.equal(graphe.cyclesNonResolus.length, 0, "aucun cycle n'est attendu à ce point de schéma historique");
  } finally {
    await prisma.$disconnect();
  }
});
