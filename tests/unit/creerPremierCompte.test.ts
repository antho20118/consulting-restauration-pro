import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import {
  creerPremierCompte,
  AucuneSocieteError,
  CompteDejaPresentError,
  SaisieCompteInvalideError,
} from "../../prisma/creerPremierCompte.js";
import { verifierCode } from "../../server/utils/auth.js";

// Tests réels du script de création du premier compte (prisma/creerPremierCompte.ts) : chaque
// scénario travaille sur sa PROPRE base PostgreSQL éphémère, réellement migrée puis détruite —
// jamais sur la base partagée "consulting" des autres fichiers de test, où des comptes existent
// toujours (le script refuse justement de s'exécuter dès qu'un compte existe). Même principe que
// tests/unit/restaurerScript.test.ts.

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

async function executerSurServeur(sql: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: urlServeur() } } });
  try {
    await prisma.$executeRawUnsafe(sql);
  } finally {
    await prisma.$disconnect();
  }
}

const bases: string[] = [];
const clients: PrismaClient[] = [];

// Base neuve, réellement migrée : exactement l'état d'une installation neuve. Une migration y crée
// déjà une société par défaut (« Mon entreprise », voir 20261005170000_cloisonne_referentiels_
// categories), mais aucun compte.
async function baseNeuve(): Promise<{ nom: string; prisma: PrismaClient }> {
  const nom = `premier_compte_${randomUUID().replace(/-/g, "")}`;
  await executerSurServeur(`CREATE DATABASE "${nom}"`);
  bases.push(nom);
  const migration = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: urlBase(nom) },
    encoding: "utf8",
  });
  assert.equal(migration.status, 0, `migrate deploy a échoué sur ${nom} : ${migration.stderr}`);
  const prisma = new PrismaClient({ datasources: { db: { url: urlBase(nom) } } });
  clients.push(prisma);
  return { nom, prisma };
}

after(async () => {
  for (const client of clients) await client.$disconnect();
  for (const nom of bases) await executerSurServeur(`DROP DATABASE IF EXISTS "${nom}" WITH (FORCE)`);
});

test("installation neuve migrée : une société par défaut mais aucun compte (constat qui motive le script)", async () => {
  const { prisma } = await baseNeuve();
  assert.equal(await prisma.utilisateur.count(), 0);
  assert.equal(await prisma.societe.count(), 1);
});

test("sans société : refus explicite (AucuneSocieteError), aucun compte créé", async () => {
  const { prisma } = await baseNeuve();
  // Base éphémère propre à ce test : la société par défaut et ce qui en dépend (catégories créées
  // par les migrations) sont retirées d'un bloc, pour reproduire une base réellement sans société.
  await prisma.$executeRawUnsafe('TRUNCATE "Societe" CASCADE');
  await assert.rejects(
    creerPremierCompte(prisma, { identifiant: "patron", code: "secret123" }),
    AucuneSocieteError
  );
  assert.equal(await prisma.utilisateur.count(), 0);
});

test("premier compte : PROPRIETAIRE actif de la société la plus ancienne, code haché vérifiable", async () => {
  const { prisma } = await baseNeuve();
  const premiere = await prisma.societe.findFirstOrThrow({ orderBy: { id: "asc" } });
  await prisma.societe.create({ data: { nom: "Autre société" } });

  const compte = await creerPremierCompte(prisma, { identifiant: "  patron  ", code: "secret123" });

  assert.equal(compte.identifiant, "patron", "l'identifiant est retaillé, comme dans l'application");
  assert.equal(compte.societeId, premiere.id);
  assert.equal(compte.superAdmin, false);
  const enBase = await prisma.utilisateur.findUniqueOrThrow({ where: { id: compte.id } });
  assert.equal(enBase.role, "PROPRIETAIRE");
  assert.equal(enBase.actif, true);
  assert.notEqual(enBase.codeHache, "secret123", "le code n'est jamais stocké en clair");
  assert.equal(verifierCode("secret123", enBase.codeHache), true, "le code haché est celui que vérifie la connexion");
  assert.equal(verifierCode("mauvais", enBase.codeHache), false);
});

test("option superAdmin : le premier compte peut recevoir le droit super-admin", async () => {
  const { prisma } = await baseNeuve();
  const compte = await creerPremierCompte(prisma, { identifiant: "patron", code: "secret123", superAdmin: true });
  assert.equal(compte.superAdmin, true);
});

test("un compte existe déjà : refus (CompteDejaPresentError), aucun second compte créé", async () => {
  const { prisma } = await baseNeuve();
  await creerPremierCompte(prisma, { identifiant: "patron", code: "secret123" });
  await assert.rejects(
    creerPremierCompte(prisma, { identifiant: "intrus", code: "secret123", superAdmin: true }),
    CompteDejaPresentError
  );
  assert.equal(await prisma.utilisateur.count(), 1);
  assert.equal(await prisma.utilisateur.findUnique({ where: { identifiant: "intrus" } }), null);
});

test("saisie invalide (identifiant vide ou trop long, code trop court ou trop long) : refus, rien créé", async () => {
  const { prisma } = await baseNeuve();
  for (const saisie of [
    { identifiant: "   ", code: "secret123" },
    { identifiant: "x".repeat(101), code: "secret123" },
    { identifiant: "patron", code: "12345" },
    { identifiant: "patron", code: "x".repeat(201) },
  ]) {
    await assert.rejects(creerPremierCompte(prisma, saisie), SaisieCompteInvalideError, JSON.stringify(saisie).slice(0, 60));
  }
  assert.equal(await prisma.utilisateur.count(), 0);
});

test("ligne de commande : code lu sur l'entrée standard (deux fois), compte créé ; sans identifiant : usage, code 1", async () => {
  const { nom, prisma } = await baseNeuve();
  const env = { ...process.env, DATABASE_URL: urlBase(nom) };

  const sansIdentifiant = spawnSync("npx", ["tsx", "prisma/creerPremierCompte.ts"], { env, encoding: "utf8", input: "" });
  assert.equal(sansIdentifiant.status, 1);
  assert.match(sansIdentifiant.stderr, /Usage/);

  const codesDifferents = spawnSync("npx", ["tsx", "prisma/creerPremierCompte.ts", "patron"], {
    env,
    encoding: "utf8",
    input: "secret123\nautre1234\n",
  });
  assert.equal(codesDifferents.status, 1);
  assert.equal(await prisma.utilisateur.count(), 0, "codes différents : aucun compte créé");

  const uneSeuleLigne = spawnSync("npx", ["tsx", "prisma/creerPremierCompte.ts", "patron"], {
    env,
    encoding: "utf8",
    input: "secret123\n",
  });
  assert.equal(uneSeuleLigne.status, 1, "confirmation absente : échec explicite, jamais un faux succès");
  assert.equal(await prisma.utilisateur.count(), 0);

  const ok = spawnSync("npx", ["tsx", "prisma/creerPremierCompte.ts", "patron", "--super-admin"], {
    env,
    encoding: "utf8",
    input: "secret123\nsecret123\n",
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stdout, /secret123/, "le code n'est jamais réaffiché");
  const compte = await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant: "patron" } });
  assert.equal(compte.superAdmin, true);
  assert.equal(verifierCode("secret123", compte.codeHache), true);
});
