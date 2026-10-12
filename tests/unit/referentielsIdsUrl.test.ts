import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { JournalErreur } from "@prisma/client";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterSuperAdminDeTest } from "../helpers/auth.js";

// Tests de régression des PUT/DELETE /:id des référentiels — voir server/routes/categories.ts,
// categoriesRecette.ts, sousCategoriesRecette.ts, tva.ts et unites.ts.
//
// Avant correctif, l'id d'URL était lu par un simple Number(req.params.id), sans aucun contrôle :
//   - "abc" ou un entier hors bornes INT4 atteignait Prisma et ressortait en 500, comme une panne ;
//   - un id DÉCIMAL ("12.5") n'était PAS refusé : Prisma le tronquait et l'opération s'appliquait
//     réellement à la ligne 12 (renommage, modification de taux/facteurBase, suppression) —
//     constaté empiriquement sur les 10 routes, c'est le défaut le plus grave de ce lot ;
// Ces cas sont désormais refusés en 400, sans écriture et sans entrée JournalErreur. Tous les
// autres comportements sont préservés.
//
// Toutes les écritures de ce fichier portent exclusivement sur des fixtures créées ici (préfixe
// REFERENTIELS-IDS-URL + UUID) : jamais sur un id existant « au hasard », y compris pour l'id
// décimal, qui vise toujours `${fixture.id}.5`. Les pannes simulées remplacent une méthode Prisma
// réellement appelée par le handler visé, pour l'espace d'un seul test, restaurée dans un finally.

const PREFIXE = "REFERENTIELS-IDS-URL";
const ID_INEXISTANT = 2147483647; // borne haute INT4 : bien formée, jamais atteinte par une séquence de test
const IDS_MAL_FORMES = ["abc", "999999999999999999999", "2147483648", "-2147483649"];

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
const journalErreurIds: number[] = [];

type Ligne = Record<string, unknown> & { id: number };

interface Referentiel {
  nom: string;
  chemin: string;
  creer: () => Promise<Ligne>;
  lire: (id: number) => Promise<Ligne | null>;
  // Fonction (jamais une valeur figée) : chaque appel doit produire un nom unique, sinon deux tests
  // renommant deux fixtures vers le même nom entrent en collision sur @@unique([societeId, nom]).
  corpsPutValide: () => Record<string, unknown>;
  corpsPutInvalide: Record<string, unknown>;
  messageCorpsInvalide: string;
  messageIdInvalide: string;
  // Statut/message actuels (préservés) pour un id bien formé mais inexistant ; null : cas non
  // couvert ici (tva.ts/unites.ts répondent encore 500, défaut distinct de la lecture de l'id).
  messagePutInexistant: string | null;
  messageDeleteInexistant: string | null;
  // Méthodes Prisma réellement appelées par chaque handler, pour la panne simulée.
  cibleMethodePut: [object, string];
  cibleMethodeDelete: [object, string];
  messagePanneMettreAJour: string;
  messagePanneSupprimer: string;
}

function nomUnique() {
  return `${PREFIXE} ${randomUUID()}`;
}

const referentiels: Referentiel[] = [
  {
    nom: "categories",
    chemin: "/api/categories",
    creer: () => prisma.categorie.create({ data: { nom: nomUnique(), societeId } }),
    lire: (id) => prisma.categorie.findUnique({ where: { id } }),
    corpsPutValide: () => ({ nom: `${nomUnique()} renommée` }),
    corpsPutInvalide: { nom: "" },
    messageCorpsInvalide: "Catégorie invalide",
    messageIdInvalide: "Identifiant de catégorie invalide",
    messagePutInexistant: "Catégorie introuvable",
    messageDeleteInexistant: "Catégorie introuvable",
    cibleMethodePut: [prisma.categorie, "update"],
    cibleMethodeDelete: [prisma.categorie, "delete"],
    messagePanneMettreAJour: "Impossible de modifier la catégorie",
    messagePanneSupprimer: "Impossible de supprimer la catégorie",
  },
  {
    nom: "categories-recette",
    chemin: "/api/categories-recette",
    creer: () => prisma.categorieRecette.create({ data: { nom: nomUnique(), societeId } }),
    lire: (id) => prisma.categorieRecette.findUnique({ where: { id } }),
    corpsPutValide: () => ({ nom: `${nomUnique()} renommée` }),
    corpsPutInvalide: { nom: "" },
    messageCorpsInvalide: "Catégorie de recette invalide",
    messageIdInvalide: "Identifiant de catégorie de recette invalide",
    messagePutInexistant: "Catégorie de recette introuvable",
    messageDeleteInexistant: "Catégorie de recette introuvable",
    cibleMethodePut: [prisma.categorieRecette, "update"],
    cibleMethodeDelete: [prisma.categorieRecette, "delete"],
    messagePanneMettreAJour: "Impossible de modifier la catégorie de recette",
    messagePanneSupprimer: "Impossible de supprimer la catégorie de recette",
  },
  {
    nom: "sous-categories-recette",
    chemin: "/api/sous-categories-recette",
    creer: () => prisma.sousCategorieRecette.create({ data: { nom: nomUnique(), societeId } }),
    lire: (id) => prisma.sousCategorieRecette.findUnique({ where: { id } }),
    corpsPutValide: () => ({ nom: `${nomUnique()} renommée` }),
    corpsPutInvalide: { nom: "" },
    messageCorpsInvalide: "Sous-catégorie de recette invalide",
    messageIdInvalide: "Identifiant de sous-catégorie de recette invalide",
    // PUT passe par findFirstOrThrow (P2025) puis repondreErreurEcriture : message générique.
    messagePutInexistant: "Ressource introuvable",
    messageDeleteInexistant: "Sous-catégorie de recette introuvable",
    // Le PUT écrit dans un prisma.$transaction (client `tx` distinct) : la panne vise $transaction.
    cibleMethodePut: [prisma, "$transaction"],
    cibleMethodeDelete: [prisma.sousCategorieRecette, "delete"],
    messagePanneMettreAJour: "Impossible de modifier la sous-catégorie de recette",
    messagePanneSupprimer: "Impossible de supprimer la sous-catégorie de recette",
  },
  {
    nom: "tva",
    chemin: "/api/tva",
    creer: () => prisma.tVA.create({ data: { nom: nomUnique(), taux: 10 } }),
    lire: (id) => prisma.tVA.findUnique({ where: { id } }),
    corpsPutValide: () => ({ taux: 7 }),
    corpsPutInvalide: { taux: 101 },
    messageCorpsInvalide: "Taux de TVA invalide",
    messageIdInvalide: "Identifiant de taux de TVA invalide",
    messagePutInexistant: null,
    messageDeleteInexistant: null,
    cibleMethodePut: [prisma.tVA, "update"],
    cibleMethodeDelete: [prisma.tVA, "delete"],
    messagePanneMettreAJour: "Impossible de modifier la TVA",
    messagePanneSupprimer: "Impossible de supprimer la TVA",
  },
  {
    nom: "unites",
    chemin: "/api/unites",
    creer: () =>
      prisma.unite.create({ data: { nom: nomUnique(), symbole: "u-ids-url", type: "poids", facteurBase: 1 } }),
    lire: (id) => prisma.unite.findUnique({ where: { id } }),
    corpsPutValide: () => ({ facteurBase: 3 }),
    corpsPutInvalide: { facteurBase: -1 },
    messageCorpsInvalide: "Unité invalide",
    messageIdInvalide: "Identifiant d'unité invalide",
    messagePutInexistant: null,
    messageDeleteInexistant: null,
    cibleMethodePut: [prisma.unite, "update"],
    cibleMethodeDelete: [prisma.unite, "delete"],
    messagePanneMettreAJour: "Impossible de modifier l'unité",
    messagePanneSupprimer: "Impossible de supprimer l'unité",
  },
];

async function requete(methode: "PUT" | "DELETE", chemin: string, corps?: unknown) {
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

// Remplace `cible[methode]` par une fonction qui lève une erreur au message unique, le temps de
// `executer`, puis restaure l'original dans un finally.
async function avecPanne<T>([cible, methode]: [object, string], message: string, executer: () => Promise<T>): Promise<T> {
  const objet = cible as Record<string, unknown>;
  const original = objet[methode];
  try {
    objet[methode] = async () => {
      throw new Error(message);
    };
    return await executer();
  } finally {
    objet[methode] = original;
  }
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

  // superAdmin : seul compte autorisé à écrire tva/unites (autoriserEcritureSuperAdmin), et
  // PROPRIETAIRE pour categories/categories-recette/sous-categories-recette. Les fixtures
  // cloisonnées sont créées dans SA société, lue sur le compte lui-même (jamais présumée).
  token = await connecterSuperAdminDeTest(baseUrl);
  const compte = await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant: "super-admin" } });
  societeId = compte.societeId;
});

after(async () => {
  try {
    await prisma.journalErreur.deleteMany({ where: { id: { in: journalErreurIds } } });
    const parPrefixe = { nom: { startsWith: PREFIXE } };
    await prisma.categorie.deleteMany({ where: parPrefixe });
    await prisma.categorieRecette.deleteMany({ where: parPrefixe });
    await prisma.sousCategorieRecette.deleteMany({ where: parPrefixe });
    await prisma.tVA.deleteMany({ where: parPrefixe });
    await prisma.unite.deleteMany({ where: parPrefixe });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

for (const r of referentiels) {
  // --- Ids mal formés : 400, aucune écriture, aucune journalisation ---

  test(`[${r.nom}] PUT id mal formé (abc, hors bornes INT4) : 400, fixture inchangée, rien journalisé`, async () => {
    const fixture = await r.creer();
    for (const id of IDS_MAL_FORMES) {
      const { resultat, entrees } = await avecInterceptionJournalisation(() =>
        requete("PUT", `${r.chemin}/${id}`, r.corpsPutValide())
      );
      assert.equal(resultat.status, 400, `id=${id} : ${JSON.stringify(resultat.corps)}`);
      assert.deepEqual(resultat.corps, { error: r.messageIdInvalide });
      assert.equal(entrees.length, 0, `id=${id} : aucune entrée JournalErreur attendue`);
    }
    assert.deepEqual(await r.lire(fixture.id), fixture);
  });

  test(`[${r.nom}] DELETE id mal formé (abc, hors bornes INT4) : 400, fixture intacte, rien journalisé`, async () => {
    const fixture = await r.creer();
    for (const id of IDS_MAL_FORMES) {
      const { resultat, entrees } = await avecInterceptionJournalisation(() => requete("DELETE", `${r.chemin}/${id}`));
      assert.equal(resultat.status, 400, `id=${id} : ${JSON.stringify(resultat.corps)}`);
      assert.deepEqual(resultat.corps, { error: r.messageIdInvalide });
      assert.equal(entrees.length, 0, `id=${id} : aucune entrée JournalErreur attendue`);
    }
    assert.deepEqual(await r.lire(fixture.id), fixture);
  });

  // --- Id décimal : jamais tronqué vers une ligne existante ---

  test(`[${r.nom}] PUT id décimal (fixture.id + ".5") : 400, la ligne fixture.id n'est PAS modifiée`, async () => {
    const fixture = await r.creer();
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      requete("PUT", `${r.chemin}/${fixture.id}.5`, r.corpsPutValide())
    );
    assert.equal(resultat.status, 400, JSON.stringify(resultat.corps));
    assert.deepEqual(resultat.corps, { error: r.messageIdInvalide });
    assert.equal(entrees.length, 0);
    assert.deepEqual(await r.lire(fixture.id), fixture);
  });

  test(`[${r.nom}] DELETE id décimal (fixture.id + ".5") : 400, la ligne fixture.id n'est PAS supprimée`, async () => {
    const fixture = await r.creer();
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      requete("DELETE", `${r.chemin}/${fixture.id}.5`)
    );
    assert.equal(resultat.status, 400, JSON.stringify(resultat.corps));
    assert.deepEqual(resultat.corps, { error: r.messageIdInvalide });
    assert.equal(entrees.length, 0);
    assert.deepEqual(await r.lire(fixture.id), fixture);
  });

  // --- Id bien formé mais inexistant : 404, rien journalisé ---

  if (r.messagePutInexistant !== null) test(`[${r.nom}] PUT id inexistant : 404, rien journalisé`, async () => {
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      requete("PUT", `${r.chemin}/${ID_INEXISTANT}`, r.corpsPutValide())
    );
    assert.equal(resultat.status, 404, JSON.stringify(resultat.corps));
    assert.deepEqual(resultat.corps, { error: r.messagePutInexistant });
    assert.equal(entrees.length, 0);
  });

  if (r.messageDeleteInexistant !== null) test(`[${r.nom}] DELETE id inexistant : 404, rien journalisé`, async () => {
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      requete("DELETE", `${r.chemin}/${ID_INEXISTANT}`)
    );
    assert.equal(resultat.status, 404, JSON.stringify(resultat.corps));
    assert.deepEqual(resultat.corps, { error: r.messageDeleteInexistant });
    assert.equal(entrees.length, 0);
  });

  // --- Contrats existants préservés ---

  test(`[${r.nom}] PUT valide : 200, modification appliquée`, async () => {
    const fixture = await r.creer();
    const envoye = r.corpsPutValide();
    const { status, corps } = await requete("PUT", `${r.chemin}/${fixture.id}`, envoye);
    assert.equal(status, 200, JSON.stringify(corps));
    assert.equal(corps.id, fixture.id);
    const relue = await r.lire(fixture.id);
    assert.ok(relue);
    for (const [cle, valeur] of Object.entries(envoye)) assert.equal(relue[cle], valeur, cle);
  });

  test(`[${r.nom}] DELETE valide : 204, ligne supprimée`, async () => {
    const fixture = await r.creer();
    const { status } = await requete("DELETE", `${r.chemin}/${fixture.id}`);
    assert.equal(status, 204);
    assert.equal(await r.lire(fixture.id), null);
  });

  test(`[${r.nom}] PUT corps invalide sur id valide : 400 de validation du corps, inchangé`, async () => {
    const fixture = await r.creer();
    const { status, corps } = await requete("PUT", `${r.chemin}/${fixture.id}`, r.corpsPutInvalide);
    assert.equal(status, 400);
    assert.equal(corps.error, r.messageCorpsInvalide);
    assert.ok(corps.details, "le détail de validation Zod reste renvoyé");
    assert.deepEqual(await r.lire(fixture.id), fixture);
  });

  test(`[${r.nom}] PUT id ET corps invalides : 400 (l'id est contrôlé en premier, comme articles/menus/dépôts)`, async () => {
    const { status, corps } = await requete("PUT", `${r.chemin}/abc`, r.corpsPutInvalide);
    assert.equal(status, 400);
    assert.deepEqual(corps, { error: r.messageIdInvalide });
  });

  // --- Une vraie panne interne reste un 500 générique, journalisé ---

  test(`[${r.nom}] PUT panne interne simulée : 500 générique et journalisé, fixture inchangée`, async () => {
    const fixture = await r.creer();
    const marqueur = `${PREFIXE} panne PUT ${randomUUID()}`;
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      avecPanne(r.cibleMethodePut, marqueur, () => requete("PUT", `${r.chemin}/${fixture.id}`, r.corpsPutValide()))
    );
    assert.equal(resultat.status, 500);
    assert.deepEqual(resultat.corps, { error: r.messagePanneMettreAJour });
    assert.equal(entrees.length, 1);
    assert.equal(entrees[0].message, marqueur);
    assert.equal(entrees[0].statutHttp, 500);
    assert.deepEqual(await r.lire(fixture.id), fixture);
  });

  test(`[${r.nom}] DELETE panne interne simulée : 500 générique et journalisé, fixture intacte`, async () => {
    const fixture = await r.creer();
    const marqueur = `${PREFIXE} panne DELETE ${randomUUID()}`;
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      avecPanne(r.cibleMethodeDelete, marqueur, () => requete("DELETE", `${r.chemin}/${fixture.id}`))
    );
    assert.equal(resultat.status, 500);
    assert.deepEqual(resultat.corps, { error: r.messagePanneSupprimer });
    assert.equal(entrees.length, 1);
    assert.equal(entrees[0].message, marqueur);
    assert.equal(entrees[0].statutHttp, 500);
    assert.deepEqual(await r.lire(fixture.id), fixture);
  });
}
