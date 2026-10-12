import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { JournalErreur } from "@prisma/client";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Tests de régression des routes /:id de recettes.ts, menus.ts, articles.ts, utilisateurs.ts et
// fournisseurs.ts (lot 2 du durcissement des ids d'URL, après les référentiels — voir
// referentielsIdsUrl.test.ts et server/utils/idUrl.ts).
//
// Avant correctif, ces routes lisaient l'id par Number(req.params.id) sans contrôle complet :
//   - "abc" ou un entier hors bornes INT4 atteignait Prisma et ressortait en 500, journalisé comme
//     une panne (les 4 routes fournisseurs déjà gardées par `Number.isInteger(id) && id > 0` ne
//     laissaient passer que l'entier positif hors bornes) ;
//   - un id DÉCIMAL ("12.5") n'était pas refusé : Prisma le tronquait et la requête visait
//     réellement la ligne 12 — lecture de la recette/du menu/du fournisseur 12, mais aussi
//     remplacement des lignes de la recette 12, suppression douce de l'article 12, changement de
//     rôle ou RÉINITIALISATION DU CODE du compte 12.
// Ces cas sont désormais refusés en 400, avant tout appel Prisma, sans écriture et sans entrée
// JournalErreur. Tous les autres comportements (y compris le statut actuel d'un id bien formé mais
// inexistant) sont préservés.
//
// Toutes les écritures portent exclusivement sur des fixtures créées ici (préfixe IDS-URL-METIER +
// UUID) : jamais sur un id existant « au hasard », y compris pour l'id décimal, qui vise toujours
// `${fixture.id}.5`. Les pannes simulées remplacent une méthode Prisma réellement appelée par le
// handler visé, pour l'espace d'un seul test, restaurée dans un finally.

const PREFIXE = "IDS-URL-METIER";
const ID_INEXISTANT = 2147483647; // borne haute INT4 : bien formée, jamais atteinte par une séquence de test
const IDS_MAL_FORMES = ["abc", "999999999999999999999", "2147483648", "-2147483649"];

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieArticleId: number;
let tvaId: number;
const journalErreurIds: number[] = [];

type Methode = "GET" | "PUT" | "DELETE" | "POST";

interface Route {
  nom: string;
  methode: Methode;
  chemin: (id: string | number) => string;
  corps?: () => Record<string, unknown>;
  // Corps invalide, pour vérifier que l'id est contrôlé en premier (routes avec corps uniquement).
  corpsInvalide?: Record<string, unknown>;
  creer: () => Promise<{ id: number }>;
  // Instantané complet de la fixture, comparé avant/après chaque requête refusée.
  instantane: (id: number) => Promise<unknown>;
  messageIdInvalide: string;
  statutValide: number;
  // Statut/corps actuels (préservés) pour un id bien formé mais inexistant.
  inexistant: { status: number; corps: unknown };
  // Méthode Prisma réellement appelée par le handler, pour la panne simulée.
  panne: [object, string];
  messagePanne: string;
}

function nomUnique() {
  return `${PREFIXE} ${randomUUID()}`;
}

const creerRecette = () => prisma.recette.create({ data: { nom: nomUnique(), societeId, portions: 1 } });
const instantaneRecette = (id: number) =>
  prisma.recette.findUnique({ where: { id }, include: { lignes: true, etapes: true } });
const creerMenu = () => prisma.menu.create({ data: { nom: nomUnique(), societeId } });
const instantaneMenu = (id: number) => prisma.menu.findUnique({ where: { id }, include: { lignes: true } });
const creerArticle = () =>
  prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: nomUnique(), societeId, categorieId: categorieArticleId, tvaId },
  });
const instantaneArticle = (id: number) => prisma.article.findUnique({ where: { id } });
const creerUtilisateur = () =>
  prisma.utilisateur.create({
    data: { identifiant: nomUnique(), codeHache: hacherCode("123456"), role: "CHEF", societeId },
  });
const instantaneUtilisateur = (id: number) => prisma.utilisateur.findUnique({ where: { id } });
const creerFournisseur = () => prisma.fournisseur.create({ data: { nom: nomUnique(), societeId } });
const instantaneFournisseur = (id: number) => prisma.fournisseur.findUnique({ where: { id } });

const RECETTE_INTROUVABLE = { error: "Recette introuvable" };
const FOURNISSEUR_INTROUVABLE = { error: "Fournisseur introuvable" };
const MESSAGE_ID_FOURNISSEUR = "Identifiant fournisseur invalide";

const routes: Route[] = [
  {
    nom: "GET /api/recettes/:id",
    methode: "GET",
    chemin: (id) => `/api/recettes/${id}`,
    creer: creerRecette,
    instantane: instantaneRecette,
    messageIdInvalide: "Identifiant de recette invalide",
    statutValide: 200,
    inexistant: { status: 404, corps: RECETTE_INTROUVABLE },
    panne: [prisma.recette, "findFirst"],
    messagePanne: "Impossible de récupérer la recette",
  },
  {
    nom: "GET /api/recettes/:id/export-pdf",
    methode: "GET",
    chemin: (id) => `/api/recettes/${id}/export-pdf`,
    creer: creerRecette,
    instantane: instantaneRecette,
    messageIdInvalide: "Identifiant de recette invalide",
    statutValide: 200,
    inexistant: { status: 404, corps: RECETTE_INTROUVABLE },
    panne: [prisma.recette, "findFirst"],
    messagePanne: "Impossible de générer la fiche PDF",
  },
  {
    nom: "GET /api/recettes/:id/suggestions-economie",
    methode: "GET",
    chemin: (id) => `/api/recettes/${id}/suggestions-economie`,
    creer: creerRecette,
    instantane: instantaneRecette,
    messageIdInvalide: "Identifiant de recette invalide",
    statutValide: 200,
    // suggestionsEconomieRecette renvoie [] pour une recette introuvable (contrat existant).
    inexistant: { status: 200, corps: [] },
    panne: [prisma.recette, "findFirst"],
    messagePanne: "Impossible de calculer les suggestions d'économies",
  },
  {
    nom: "PUT /api/recettes/:id",
    methode: "PUT",
    chemin: (id) => `/api/recettes/${id}`,
    corps: () => ({ nom: `${nomUnique()} modifiée`, portions: 2, lignes: [], etapes: [] }),
    corpsInvalide: { nom: "" },
    creer: creerRecette,
    instantane: instantaneRecette,
    messageIdInvalide: "Identifiant de recette invalide",
    statutValide: 200,
    // findFirstOrThrow (P2025) puis repondreErreurEcriture : message générique.
    inexistant: { status: 404, corps: { error: "Ressource introuvable" } },
    panne: [prisma, "$transaction"],
    messagePanne: "Impossible de mettre à jour la recette",
  },
  {
    nom: "DELETE /api/recettes/:id",
    methode: "DELETE",
    chemin: (id) => `/api/recettes/${id}`,
    creer: creerRecette,
    instantane: instantaneRecette,
    messageIdInvalide: "Identifiant de recette invalide",
    statutValide: 204,
    inexistant: { status: 404, corps: RECETTE_INTROUVABLE },
    panne: [prisma.recette, "updateMany"],
    messagePanne: "Impossible de supprimer la recette",
  },
  {
    nom: "GET /api/menus/:id",
    methode: "GET",
    chemin: (id) => `/api/menus/${id}`,
    creer: creerMenu,
    instantane: instantaneMenu,
    messageIdInvalide: "Identifiant de menu invalide",
    statutValide: 200,
    inexistant: { status: 404, corps: { error: "Menu introuvable" } },
    panne: [prisma.menu, "findFirst"],
    messagePanne: "Impossible de récupérer le menu",
  },
  {
    nom: "DELETE /api/menus/:id",
    methode: "DELETE",
    chemin: (id) => `/api/menus/${id}`,
    creer: creerMenu,
    instantane: instantaneMenu,
    messageIdInvalide: "Identifiant de menu invalide",
    statutValide: 204,
    inexistant: { status: 404, corps: { error: "Menu introuvable" } },
    panne: [prisma.menu, "updateMany"],
    messagePanne: "Impossible de supprimer le menu",
  },
  {
    nom: "DELETE /api/articles/:id",
    methode: "DELETE",
    chemin: (id) => `/api/articles/${id}`,
    creer: creerArticle,
    instantane: instantaneArticle,
    messageIdInvalide: "Identifiant d'article invalide",
    statutValide: 204,
    inexistant: { status: 404, corps: { error: "Article introuvable" } },
    panne: [prisma.article, "updateMany"],
    messagePanne: "Impossible de supprimer l'article",
  },
  {
    nom: "PUT /api/utilisateurs/:id",
    methode: "PUT",
    chemin: (id) => `/api/utilisateurs/${id}`,
    corps: () => ({ role: "CUISINIER" }),
    corpsInvalide: { role: "INCONNU" },
    creer: creerUtilisateur,
    instantane: instantaneUtilisateur,
    messageIdInvalide: "Identifiant de compte invalide",
    statutValide: 200,
    inexistant: { status: 404, corps: { error: "Compte introuvable" } },
    panne: [prisma.utilisateur, "update"],
    messagePanne: "Impossible de modifier le compte",
  },
  {
    nom: "POST /api/utilisateurs/:id/reinitialiser-code",
    methode: "POST",
    chemin: (id) => `/api/utilisateurs/${id}/reinitialiser-code`,
    corps: () => ({ nouveauCode: "654321" }),
    corpsInvalide: { nouveauCode: "1" },
    creer: creerUtilisateur,
    instantane: instantaneUtilisateur,
    messageIdInvalide: "Identifiant de compte invalide",
    statutValide: 204,
    inexistant: { status: 404, corps: { error: "Compte introuvable" } },
    panne: [prisma.utilisateur, "update"],
    messagePanne: "Impossible de réinitialiser le code",
  },
  {
    nom: "GET /api/fournisseurs/:id",
    methode: "GET",
    chemin: (id) => `/api/fournisseurs/${id}`,
    creer: creerFournisseur,
    instantane: instantaneFournisseur,
    messageIdInvalide: MESSAGE_ID_FOURNISSEUR,
    statutValide: 200,
    inexistant: { status: 404, corps: FOURNISSEUR_INTROUVABLE },
    panne: [prisma.fournisseur, "findFirst"],
    messagePanne: "Impossible de récupérer ce fournisseur",
  },
  {
    nom: "GET /api/fournisseurs/:id/tarifs",
    methode: "GET",
    chemin: (id) => `/api/fournisseurs/${id}/tarifs`,
    creer: creerFournisseur,
    instantane: instantaneFournisseur,
    messageIdInvalide: MESSAGE_ID_FOURNISSEUR,
    statutValide: 200,
    inexistant: { status: 404, corps: FOURNISSEUR_INTROUVABLE },
    panne: [prisma.tarifArticle, "findMany"],
    messagePanne: "Impossible de récupérer les tarifs de ce fournisseur",
  },
  {
    nom: "GET /api/fournisseurs/:id/documents",
    methode: "GET",
    chemin: (id) => `/api/fournisseurs/${id}/documents`,
    creer: creerFournisseur,
    instantane: instantaneFournisseur,
    messageIdInvalide: MESSAGE_ID_FOURNISSEUR,
    statutValide: 200,
    inexistant: { status: 404, corps: FOURNISSEUR_INTROUVABLE },
    panne: [prisma.documentFournisseur, "findMany"],
    messagePanne: "Impossible de récupérer les documents de ce fournisseur",
  },
  {
    nom: "PUT /api/fournisseurs/:id",
    methode: "PUT",
    chemin: (id) => `/api/fournisseurs/${id}`,
    corps: () => ({ nom: `${nomUnique()} modifié` }),
    corpsInvalide: { nom: "" },
    creer: creerFournisseur,
    instantane: instantaneFournisseur,
    messageIdInvalide: MESSAGE_ID_FOURNISSEUR,
    statutValide: 200,
    inexistant: { status: 404, corps: FOURNISSEUR_INTROUVABLE },
    panne: [prisma.fournisseur, "update"],
    messagePanne: "Impossible de modifier le fournisseur",
  },
  {
    nom: "DELETE /api/fournisseurs/:id",
    methode: "DELETE",
    chemin: (id) => `/api/fournisseurs/${id}`,
    creer: creerFournisseur,
    instantane: instantaneFournisseur,
    messageIdInvalide: MESSAGE_ID_FOURNISSEUR,
    statutValide: 204,
    inexistant: { status: 404, corps: FOURNISSEUR_INTROUVABLE },
    panne: [prisma.fournisseur, "updateMany"],
    messagePanne: "Impossible de supprimer le fournisseur",
  },
  {
    nom: "POST /api/fournisseurs/:id/reactiver",
    methode: "POST",
    chemin: (id) => `/api/fournisseurs/${id}/reactiver`,
    corps: () => ({}),
    creer: () => prisma.fournisseur.create({ data: { nom: nomUnique(), societeId, actif: false } }),
    instantane: instantaneFournisseur,
    messageIdInvalide: MESSAGE_ID_FOURNISSEUR,
    statutValide: 200,
    inexistant: { status: 404, corps: FOURNISSEUR_INTROUVABLE },
    panne: [prisma.fournisseur, "update"],
    messagePanne: "Impossible de réactiver le fournisseur",
  },
];

async function requete(methode: Methode, chemin: string, corps?: unknown) {
  const reponse = await fetch(`${baseUrl}${chemin}`, {
    method: methode,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const typeContenu = reponse.headers.get("content-type") ?? "";
  if (!typeContenu.includes("application/json")) {
    await reponse.arrayBuffer();
    return { status: reponse.status, typeContenu, corps: null };
  }
  return { status: reponse.status, typeContenu, corps: await reponse.json() };
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

  // PROPRIETAIRE : seul rôle autorisé sur /api/utilisateurs, et autorisé sur toutes les autres
  // routes de ce fichier. Les fixtures sont créées dans SA société, lue sur le compte lui-même.
  token = await connecterAdminDeTest(baseUrl);
  const compte = await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant: "admin" } });
  societeId = compte.societeId;
  const categorie =
    (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ??
    (await prisma.categorie.create({ data: { nom: `${PREFIXE} catégorie`, societeId } }));
  categorieArticleId = categorie.id;
  const tva =
    (await prisma.tVA.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.tVA.create({ data: { nom: `${PREFIXE} TVA`, taux: 5.5 } }));
  tvaId = tva.id;
});

after(async () => {
  try {
    await prisma.journalErreur.deleteMany({ where: { id: { in: journalErreurIds } } });
    const parPrefixe = { nom: { startsWith: PREFIXE } };
    await prisma.recetteLigne.deleteMany({ where: { recette: parPrefixe } });
    await prisma.recetteEtape.deleteMany({ where: { recette: parPrefixe } });
    await prisma.recette.deleteMany({ where: parPrefixe });
    await prisma.menuLigne.deleteMany({ where: { menu: parPrefixe } });
    await prisma.menu.deleteMany({ where: parPrefixe });
    await prisma.article.deleteMany({ where: parPrefixe });
    await prisma.utilisateur.deleteMany({ where: { identifiant: { startsWith: PREFIXE } } });
    await prisma.fournisseur.deleteMany({ where: parPrefixe });
    await prisma.categorie.deleteMany({ where: parPrefixe });
    await prisma.tVA.deleteMany({ where: parPrefixe });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

for (const r of routes) {
  const corps = () => (r.corps ? r.corps() : undefined);

  test(`[${r.nom}] id mal formé (abc, hors bornes INT4) : 400, fixture inchangée, rien journalisé`, async () => {
    const fixture = await r.creer();
    const avant = await r.instantane(fixture.id);
    for (const id of IDS_MAL_FORMES) {
      const { resultat, entrees } = await avecInterceptionJournalisation(() => requete(r.methode, r.chemin(id), corps()));
      assert.equal(resultat.status, 400, `id=${id} : ${JSON.stringify(resultat.corps)}`);
      assert.deepEqual(resultat.corps, { error: r.messageIdInvalide });
      assert.equal(entrees.length, 0, `id=${id} : aucune entrée JournalErreur attendue`);
    }
    assert.deepEqual(await r.instantane(fixture.id), avant);
  });

  test(`[${r.nom}] id décimal (fixture.id + ".5") : 400, la ligne fixture.id n'est ni lue ni modifiée`, async () => {
    const fixture = await r.creer();
    const avant = await r.instantane(fixture.id);
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      requete(r.methode, r.chemin(`${fixture.id}.5`), corps())
    );
    assert.equal(resultat.status, 400, JSON.stringify(resultat.corps));
    assert.deepEqual(resultat.corps, { error: r.messageIdInvalide });
    assert.equal(entrees.length, 0);
    assert.deepEqual(await r.instantane(fixture.id), avant);
  });

  test(`[${r.nom}] id inexistant : statut actuel préservé (${r.inexistant.status}), rien journalisé`, async () => {
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      requete(r.methode, r.chemin(ID_INEXISTANT), corps())
    );
    assert.equal(resultat.status, r.inexistant.status, JSON.stringify(resultat.corps));
    assert.deepEqual(resultat.corps, r.inexistant.corps);
    assert.equal(entrees.length, 0);
  });

  test(`[${r.nom}] id valide : ${r.statutValide}, contrat préservé`, async () => {
    const fixture = await r.creer();
    const resultat = await requete(r.methode, r.chemin(fixture.id), corps());
    assert.equal(resultat.status, r.statutValide, JSON.stringify(resultat.corps));
    if (r.nom.endsWith("export-pdf")) {
      assert.match(resultat.typeContenu, /application\/pdf/);
    } else if (r.statutValide === 200 && resultat.corps && !Array.isArray(resultat.corps)) {
      assert.equal(resultat.corps.id, fixture.id);
    }
  });

  if (r.corpsInvalide) {
    const corpsInvalide = r.corpsInvalide;
    test(`[${r.nom}] id ET corps invalides : 400 sur l'id (contrôlé en premier, comme articles/menus/dépôts)`, async () => {
      const resultat = await requete(r.methode, r.chemin("abc"), corpsInvalide);
      assert.equal(resultat.status, 400);
      assert.deepEqual(resultat.corps, { error: r.messageIdInvalide });
    });
  }

  test(`[${r.nom}] panne interne simulée : 500 générique et journalisé, fixture inchangée`, async () => {
    const fixture = await r.creer();
    const avant = await r.instantane(fixture.id);
    const marqueur = `${PREFIXE} panne ${randomUUID()}`;
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      avecPanne(r.panne, marqueur, () => requete(r.methode, r.chemin(fixture.id), corps()))
    );
    assert.equal(resultat.status, 500);
    assert.deepEqual(resultat.corps, { error: r.messagePanne });
    assert.equal(entrees.length, 1);
    assert.equal(entrees[0].message, marqueur);
    assert.equal(entrees[0].statutHttp, 500);
    assert.deepEqual(await r.instantane(fixture.id), avant);
  });
}

// Effets réels du défaut d'id décimal sur le code d'avant correctif, vérifiés ici de façon
// explicite pour les deux écritures les plus sensibles (au-delà du simple statut HTTP).
test("[reinitialiser-code] id décimal : le code du compte fixture.id n'est jamais réinitialisé", async () => {
  const fixture = await creerUtilisateur();
  await requete("POST", `/api/utilisateurs/${fixture.id}.5/reinitialiser-code`, { nouveauCode: "999999" });
  const apres = await prisma.utilisateur.findUniqueOrThrow({ where: { id: fixture.id } });
  assert.equal(apres.codeHache, fixture.codeHache, "le code haché du compte visé par troncature ne doit pas changer");
});

test("[PUT recettes] id décimal : les lignes de la recette fixture.id ne sont jamais remplacées", async () => {
  const fixture = await creerRecette();
  await prisma.recetteEtape.create({
    data: { recetteId: fixture.id, description: `${PREFIXE} étape`, ordre: 0, pointCritiqueHACCP: false },
  });
  await requete("PUT", `/api/recettes/${fixture.id}.5`, { nom: `${nomUnique()} écrasée`, portions: 1, lignes: [], etapes: [] });
  const apres = await prisma.recette.findUniqueOrThrow({ where: { id: fixture.id }, include: { etapes: true } });
  assert.equal(apres.nom, fixture.nom);
  assert.equal(apres.etapes.length, 1, "l'étape existante ne doit pas être supprimée");
});
