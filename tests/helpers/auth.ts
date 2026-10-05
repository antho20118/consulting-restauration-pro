import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Remplace l'ancien AccesApplication partagé (voir migration 20260930090000_utilisateurs_roles) :
// un compte de test PROPRIETAIRE unique, réutilisé par tous les fichiers de test (find-or-create
// idempotent, comme l'était déjà AccesApplication) — jamais recréé à chaque suite, pour rester
// compatible avec les exécutions parallèles de node --test sur la même base. PROPRIETAIRE parce que
// la quasi-totalité des tests existants couvrent des routes d'écriture toutes catégories (prix,
// fournisseurs, paramètres...), jamais restreintes à un rôle en particulier.
export async function connecterAdminDeTest(baseUrl: string): Promise<string> {
  const societe =
    (await prisma.societe.findFirst()) ??
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
    (await prisma.societe.findFirst()) ??
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
    (await prisma.societe.findFirst()) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  return societe.id;
}

// Équivalent e2e de connecterSuperAdminDeTest : compte distinct de "admin" (superAdmin ne doit
// jamais être vrai sur un compte PROPRIETAIRE "normal" — voir sauvegardesParametres.spec.ts, qui
// vérifie les deux cas).
export async function creerSuperAdminDeTestAvecSociete(): Promise<number> {
  const societe =
    (await prisma.societe.findFirst()) ??
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
