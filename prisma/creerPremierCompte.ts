// Crée le PREMIER compte de connexion (PROPRIETAIRE) d'une installation neuve.
//
// Une base fraîchement migrée puis initialisée (npm run db:seed) contient une société mais AUCUN
// compte : le seul compte historique ne provient que de la migration de l'ancien identifiant
// partagé (voir prisma/migrations/20260930090000_utilisateurs_roles), qui n'insère rien quand
// aucune société n'existe encore au moment où elle s'exécute — impossible, sans ce script, de se
// connecter à une nouvelle installation (poste local, nouveau serveur, restauration à blanc).
//
// Volontairement limité au tout premier compte : il refuse de s'exécuter dès qu'un compte existe,
// pour ne jamais servir de moyen détourné de créer un PROPRIETAIRE sur une base déjà en service
// (les comptes suivants se créent depuis l'application, Paramètres → Comptes).
//
// Usage : npm run compte:creer -- <identifiant> [--super-admin]
// Le code est demandé au clavier (deux fois, sans être affiché) — jamais passé en argument, pour
// ne jamais apparaître dans l'historique du terminal ni dans la liste des processus.

import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { hacherCode } from "../server/utils/auth.js";

export class CompteDejaPresentError extends Error {}
export class AucuneSocieteError extends Error {}
export class SaisieCompteInvalideError extends Error {}

// Mêmes bornes que la création d'un compte depuis l'application (voir schemaCreation dans
// server/routes/utilisateurs.ts).
const IDENTIFIANT_MAX = 100;
const CODE_MIN = 6;
const CODE_MAX = 200;

export async function creerPremierCompte(
  prisma: PrismaClient,
  saisie: { identifiant: string; code: string; superAdmin?: boolean }
): Promise<{ id: number; identifiant: string; societeId: number; superAdmin: boolean }> {
  const identifiant = saisie.identifiant.trim();
  if (identifiant.length === 0 || identifiant.length > IDENTIFIANT_MAX) {
    throw new SaisieCompteInvalideError(`L'identifiant doit faire entre 1 et ${IDENTIFIANT_MAX} caractères.`);
  }
  if (saisie.code.length < CODE_MIN || saisie.code.length > CODE_MAX) {
    throw new SaisieCompteInvalideError(`Le code doit faire entre ${CODE_MIN} et ${CODE_MAX} caractères.`);
  }

  // Sérialisable : la vérification « aucun compte » et la création ne peuvent jamais être
  // entrelacées avec une autre exécution simultanée (deux premiers comptes créés en même temps).
  return prisma.$transaction(
    async (tx) => {
      if ((await tx.utilisateur.count()) > 0) {
        throw new CompteDejaPresentError(
          "Un compte existe déjà : crée les comptes suivants depuis l'application (Paramètres → Comptes)."
        );
      }
      const societe = await tx.societe.findFirst({ orderBy: { id: "asc" } });
      if (!societe) {
        throw new AucuneSocieteError("Aucune société en base : lance d'abord npm run db:seed.");
      }
      return tx.utilisateur.create({
        data: {
          identifiant,
          codeHache: hacherCode(saisie.code),
          role: "PROPRIETAIRE",
          actif: true,
          superAdmin: saisie.superAdmin ?? false,
          societeId: societe.id,
        },
        select: { id: true, identifiant: true, societeId: true, superAdmin: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

// Lit les deux saisies du code : au clavier sans les afficher (terminal interactif), ou les deux
// premières lignes de l'entrée standard quand elle est redirigée (ex. tests automatisés). Dans ce
// second cas, TOUTES les lignes sont lues d'abord : des questions successives perdraient une ligne
// déjà reçue, et le script se terminerait alors sans rien créer ni signaler d'erreur.
async function lireCodes(): Promise<[string, string] | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  try {
    if (!process.stdin.isTTY) {
      const lignes: string[] = [];
      for await (const ligne of rl) lignes.push(ligne);
      return lignes.length >= 2 ? [lignes[0], lignes[1]] : null;
    }
    const sortie = rl as unknown as { _writeToOutput?: (texte: string) => void };
    const demanderMasque = (question: string) =>
      new Promise<string>((resolve) => {
        process.stdout.write(question);
        sortie._writeToOutput = () => {};
        rl.question("", (reponse) => {
          delete sortie._writeToOutput;
          process.stdout.write("\n");
          resolve(reponse);
        });
      });
    const code = await demanderMasque("Code (6 caractères minimum) : ");
    const confirmation = await demanderMasque("Confirme le code : ");
    return [code, confirmation];
  } finally {
    rl.close();
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const identifiant = args.find((a) => !a.startsWith("--"));
  if (!identifiant) {
    console.error("Usage : npm run compte:creer -- <identifiant> [--super-admin]");
    return 1;
  }
  const superAdmin = args.includes("--super-admin");

  const codes = await lireCodes();
  if (!codes) {
    console.error("Code et confirmation attendus (deux lignes) : aucun compte créé.");
    return 1;
  }
  const [code, confirmation] = codes;
  if (code !== confirmation) {
    console.error("Les deux codes ne correspondent pas : aucun compte créé.");
    return 1;
  }

  const prisma = new PrismaClient();
  try {
    const compte = await creerPremierCompte(prisma, { identifiant, code, superAdmin });
    console.log(
      `✅ Compte « ${compte.identifiant} » créé (propriétaire${compte.superAdmin ? ", super-admin" : ""}, société #${compte.societeId}).`
    );
    return 0;
  } catch (error) {
    if (
      error instanceof CompteDejaPresentError ||
      error instanceof AucuneSocieteError ||
      error instanceof SaisieCompteInvalideError
    ) {
      console.error(`❌ ${error.message}`);
      return 1;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Exécuté seulement en ligne de commande, jamais à l'import (tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (codeSortie) => process.exit(codeSortie),
    (error) => {
      console.error(error);
      process.exit(1);
    }
  );
}
