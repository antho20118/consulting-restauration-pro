import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { JournalErreur } from "@prisma/client";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Tests de régression des ids d'URL de commandes.ts, productions.ts, listingsFournisseur.ts,
// documentsFournisseurs.ts et haccp.ts (lot 3 du durcissement des ids d'URL, après
// referentielsIdsUrl.test.ts et idsUrlRessourcesMetier.test.ts — voir server/utils/idUrl.ts).
//
// Ces routes refusaient déjà en 400 un id non entier, décimal ou <= 0 (garde
// `Number.isInteger(id) && id > 0`, ou z.coerce.number().int().positive() pour haccp.ts), mais
// aucune ne bornait l'id par le haut : un entier positif au-delà de INT4 (2147483648 et plus)
// passait la garde, atteignait Prisma et ressortait en 500, journalisé comme une panne. Il est
// désormais refusé en 400 avec le même message que les autres ids invalides de la route, sans
// entrée JournalErreur. Les refus déjà en place et le 404 d'un id bien formé mais inexistant sont
// préservés à l'identique.
//
// Aucune fixture n'est nécessaire : tous les cas testés sont refusés avant tout accès à la base,
// ou s'arrêtent sur une recherche (lecture) scopée par société qui ne trouve rien. Les chemins
// valides de ces routes restent couverts par leurs fichiers de test dédiés (commandes.test.ts,
// productions.test.ts, listingsFournisseur.test.ts, facturesFournisseur.test.ts...).

const ID_INEXISTANT = 2147483647; // borne haute INT4 : bien formée, jamais atteinte par une séquence de test
const IDS_HORS_BORNE_HAUTE = ["2147483648", "999999999999999999999"];
const IDS_DEJA_REFUSES = ["abc", "1.5", "0", "-1", "-2147483649"];

let server: Server;
let baseUrl: string;
let token: string;
const journalErreurIds: number[] = [];

type Methode = "GET" | "POST";

interface Route {
  nom: string;
  methode: Methode;
  chemin: (id: string | number) => string;
  // Corps valide (structure) pour atteindre la recherche scopée sur un id inexistant.
  corps?: Record<string, unknown>;
  messageIdInvalide: string;
  inexistant: { status: number; corps: unknown };
}

const routes: Route[] = [
  {
    nom: "GET /api/commandes/:id",
    methode: "GET",
    chemin: (id) => `/api/commandes/${id}`,
    messageIdInvalide: "Identifiant de commande invalide",
    inexistant: { status: 404, corps: { error: "Commande introuvable" } },
  },
  {
    nom: "POST /api/commandes/:id/receptionner",
    methode: "POST",
    chemin: (id) => `/api/commandes/${id}/receptionner`,
    corps: { lignes: [{ ligneId: 1, quantiteRecueBase: 1 }] },
    messageIdInvalide: "Identifiant de commande invalide",
    inexistant: { status: 404, corps: { error: "Commande introuvable" } },
  },
  {
    nom: "POST /api/commandes/:id/annuler",
    methode: "POST",
    chemin: (id) => `/api/commandes/${id}/annuler`,
    corps: {},
    messageIdInvalide: "Identifiant de commande invalide",
    inexistant: { status: 404, corps: { error: "Commande introuvable" } },
  },
  {
    nom: "GET /api/productions/:id",
    methode: "GET",
    chemin: (id) => `/api/productions/${id}`,
    messageIdInvalide: "Identifiant de production invalide",
    inexistant: { status: 404, corps: { error: "Production introuvable" } },
  },
  {
    nom: "POST /api/productions/:id/controles",
    methode: "POST",
    chemin: (id) => `/api/productions/${id}/controles`,
    corps: { recetteEtapeId: 1, valeur: "IDS-URL-BORNE-HAUTE", conforme: true },
    messageIdInvalide: "Identifiant de production invalide",
    inexistant: { status: 404, corps: { error: "Production introuvable" } },
  },
  {
    nom: "POST /api/listings-fournisseur/:fournisseurId",
    methode: "POST",
    chemin: (id) => `/api/listings-fournisseur/${id}`,
    corps: {},
    messageIdInvalide: "Identifiant fournisseur invalide",
    inexistant: { status: 404, corps: { error: "Fournisseur introuvable" } },
  },
  {
    nom: "POST /api/listings-fournisseur/factures/:fournisseurId",
    methode: "POST",
    chemin: (id) => `/api/listings-fournisseur/factures/${id}`,
    corps: {},
    messageIdInvalide: "Identifiant fournisseur invalide",
    inexistant: { status: 404, corps: { error: "Fournisseur introuvable" } },
  },
  {
    nom: "GET /api/listings-fournisseur/documents/:documentId",
    methode: "GET",
    chemin: (id) => `/api/listings-fournisseur/documents/${id}`,
    messageIdInvalide: "Identifiant de document invalide",
    inexistant: { status: 404, corps: { error: "Document introuvable" } },
  },
  {
    nom: "POST /api/listings-fournisseur/documents/:documentId/valider",
    methode: "POST",
    chemin: (id) => `/api/listings-fournisseur/documents/${id}/valider`,
    corps: { decisions: [{ ligneId: 1, decision: "REJETEE" }] },
    messageIdInvalide: "Identifiant de document invalide",
    inexistant: { status: 404, corps: { error: "Document introuvable" } },
  },
  {
    nom: "GET /api/documents-fournisseurs/:fournisseurId/:cle",
    methode: "GET",
    chemin: (id) => `/api/documents-fournisseurs/${id}/${randomUUID()}`,
    messageIdInvalide: "Identifiant fournisseur invalide",
    inexistant: { status: 404, corps: { error: "Document introuvable" } },
  },
  {
    nom: "GET /api/haccp/evaluer/:id",
    methode: "GET",
    chemin: (id) => `/api/haccp/evaluer/${id}`,
    messageIdInvalide: "Identifiant invalide",
    inexistant: { status: 404, corps: { error: "Recette introuvable" } },
  },
];

async function requete(methode: Methode, chemin: string, corps?: unknown) {
  const reponse = await fetch(`${baseUrl}${chemin}`, {
    method: methode,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  return { status: reponse.status, corps: texte ? JSON.parse(texte) : null };
}

// Interception confinée de la seule écriture que journaliserErreur effectue réellement
// (prisma.journalErreur.create) : capture les lignes exactement créées par `executer`, puis
// restaure la méthode originale dans un finally, que `executer` réussisse ou échoue.
async function avecInterceptionJournalisation<T>(executer: () => Promise<T>): Promise<{ resultat: T; entrees: JournalErreur[] }> {
  const original = prisma.journalErreur.create;
  const entrees: JournalErreur[] = [];
  let resultat: T;
  try {
    // @ts-expect-error — remplacement volontaire et confiné à cette fonction, restauré ci-dessous.
    prisma.journalErreur.create = async (args: Parameters<typeof original>[0]) => {
      const entree = await original(args);
      journalErreurIds.push(entree.id);
      entrees.push(entree);
      return entree;
    };
    resultat = await executer();
  } finally {
    prisma.journalErreur.create = original;
  }
  return { resultat, entrees };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;
  token = await connecterAdminDeTest(baseUrl);
});

after(async () => {
  try {
    await prisma.journalErreur.deleteMany({ where: { id: { in: journalErreurIds } } });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

for (const r of routes) {
  test(`[${r.nom}] id positif au-delà de INT4 : 400, rien journalisé`, async () => {
    for (const id of IDS_HORS_BORNE_HAUTE) {
      const { resultat, entrees } = await avecInterceptionJournalisation(() => requete(r.methode, r.chemin(id), r.corps));
      assert.equal(resultat.status, 400, `id=${id} : ${JSON.stringify(resultat.corps)}`);
      assert.deepEqual(resultat.corps, { error: r.messageIdInvalide });
      assert.equal(entrees.length, 0, `id=${id} : aucune entrée JournalErreur attendue`);
    }
  });

  test(`[${r.nom}] ids déjà refusés (abc, décimal, <= 0) : 400 inchangé, rien journalisé`, async () => {
    for (const id of IDS_DEJA_REFUSES) {
      const { resultat, entrees } = await avecInterceptionJournalisation(() => requete(r.methode, r.chemin(id), r.corps));
      assert.equal(resultat.status, 400, `id=${id} : ${JSON.stringify(resultat.corps)}`);
      assert.deepEqual(resultat.corps, { error: r.messageIdInvalide });
      assert.equal(entrees.length, 0, `id=${id} : aucune entrée JournalErreur attendue`);
    }
  });

  test(`[${r.nom}] id inexistant (borne haute INT4 incluse) : ${r.inexistant.status} inchangé, rien journalisé`, async () => {
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      requete(r.methode, r.chemin(ID_INEXISTANT), r.corps)
    );
    assert.equal(resultat.status, r.inexistant.status, JSON.stringify(resultat.corps));
    assert.deepEqual(resultat.corps, r.inexistant.corps);
    assert.equal(entrees.length, 0);
  });
}
