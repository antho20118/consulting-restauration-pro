import { randomUUID } from "node:crypto";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Remplace l'ancien AccesApplication partagé (voir migration 20260930090000_utilisateurs_roles) :
// un compte de test PROPRIETAIRE unique, réutilisé par tous les fichiers de test (find-or-create
// idempotent, comme l'était déjà AccesApplication) — jamais recréé à chaque suite, pour rester
// compatible avec les exécutions parallèles de node --test sur la même base. PROPRIETAIRE parce que
// la quasi-totalité des tests existants couvrent des routes d'écriture toutes catégories (prix,
// fournisseurs, paramètres...), jamais restreintes à un rôle en particulier.
//
// orderBy id asc impératif ici (et sur tous les findFirst() de Societe « par défaut » ci-dessous,
// ainsi que dans chaque fichier de test qui fait le même findFirst() pour son propre societeId) :
// depuis F07 (creerUtilisateurAutreSocieteDeTest, plus bas), plusieurs Societe coexistent souvent
// en base pendant la suite. Un findFirst() sans tri n'a AUCUNE garantie SQL de renvoyer la plus
// ancienne — Postgres peut renvoyer une société créée puis non nettoyée (crash d'un test), ce qui
// désynchronise silencieusement le jeton (ici) du societeId que chaque fichier utilise pour ses
// propres fixtures, et fait échouer des tests sans rapport avec l'isolation société elle-même
// (observé empiriquement : societe.findFirst() renvoyait une société « isolation » orpheline d'un
// run interrompu, pas la Société de test #1).
export async function connecterAdminDeTest(baseUrl: string): Promise<string> {
  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));

  const identifiant = "admin";
  const existant = await prisma.utilisateur.findUnique({ where: { identifiant } });
  if (!existant) {
    await prisma.utilisateur.create({
      data: {
        identifiant,
        codeHache: hacherCode("1234"),
        role: "PROPRIETAIRE",
        societeId: societe.id,
      },
    });
  }

  const reponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const donnees = await reponse.json();
  return donnees.token;
}

// Compte distinct de connecterAdminDeTest : superAdmin est un flag séparé du rôle PROPRIETAIRE
// (voir server/middleware/requireSuperAdmin.ts) — un PROPRIETAIRE "normal" ne doit PAS l'avoir, donc
// un second compte est nécessaire pour tester les deux cas (voir sauvegardesRoute.test.ts).
export async function connecterSuperAdminDeTest(baseUrl: string): Promise<string> {
  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));

  const identifiant = "super-admin";
  const existant = await prisma.utilisateur.findUnique({ where: { identifiant } });
  if (!existant) {
    await prisma.utilisateur.create({
      data: {
        identifiant,
        codeHache: hacherCode("1234"),
        role: "PROPRIETAIRE",
        societeId: societe.id,
        superAdmin: true,
      },
    });
  } else if (!existant.superAdmin) {
    await prisma.utilisateur.update({ where: { id: existant.id }, data: { superAdmin: true } });
  }

  const reponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const donnees = await reponse.json();
  return donnees.token;
}

// Pour les tests de non-régression d'isolation inter-société (F07 de l'audit forensique) : une
// VRAIE autre société, avec son propre compte, distincte de celle de connecterAdminDeTest — jamais
// un simple societeId falsifié dans le corps d'une requête (voir F02, qui a montré que ça ne teste
// rien de réel une fois le filtrage serveur corrigé). Identifiant aléatoire (randomUUID) : chaque
// appel crée un compte et une société frais, sans collision possible entre fichiers de test
// exécutés en parallèle.
export async function creerUtilisateurAutreSocieteDeTest(
  baseUrl: string
): Promise<{ token: string; societeId: number }> {
  const societe = await prisma.societe.create({ data: { nom: `Société de test isolation ${randomUUID()}` } });
  const identifiant = `isolation-test-${randomUUID()}`;
  await prisma.utilisateur.create({
    data: { identifiant, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId: societe.id },
  });

  const reponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  const donnees = await reponse.json();
  return { token: donnees.token, societeId: societe.id };
}

// Pour les tests e2e (Playwright) : ceux-ci se connectent via la vraie interface (saisie
// identifiant/code), jamais par un appel direct à /api/auth/login — seule la création du compte en
// base est nécessaire ici, pas de jeton à récupérer.
export async function creerUtilisateurAdminDeTest(societeId: number): Promise<void> {
  const identifiant = "admin";
  const existant = await prisma.utilisateur.findUnique({ where: { identifiant } });
  if (!existant) {
    await prisma.utilisateur.create({
      data: { identifiant, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId },
    });
  }
}

// Même chose, pour un test e2e qui n'a par ailleurs besoin d'aucune société précise (écrans de
// lecture seule, audit mobile...) : trouve ou crée une société par défaut plutôt que d'exiger que
// l'appelant en gère une lui-même.
export async function creerAdminDeTestAvecSociete(): Promise<number> {
  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  return societe.id;
}

// Équivalent e2e de connecterSuperAdminDeTest : compte distinct de "admin" (superAdmin ne doit
// jamais être vrai sur un compte PROPRIETAIRE "normal" — voir sauvegardesParametres.spec.ts, qui
// vérifie les deux cas).
export async function creerSuperAdminDeTestAvecSociete(): Promise<number> {
  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));

  const identifiant = "super-admin";
  const existant = await prisma.utilisateur.findUnique({ where: { identifiant } });
  if (!existant) {
    await prisma.utilisateur.create({
      data: {
        identifiant,
        codeHache: hacherCode("1234"),
        role: "PROPRIETAIRE",
        societeId: societe.id,
        superAdmin: true,
      },
    });
  } else if (!existant.superAdmin) {
    await prisma.utilisateur.update({ where: { id: existant.id }, data: { superAdmin: true } });
  }
  return societe.id;
}
