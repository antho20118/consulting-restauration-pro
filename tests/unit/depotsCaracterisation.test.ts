import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { JournalErreur } from "@prisma/client";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest, creerUtilisateurAutreSocieteDeTest } from "../helpers/auth.js";

// Tests de régression de POST /api/depots, PUT /api/depots/:id et DELETE /api/depots/:id — voir
// server/routes/depots.ts.
//
// Avant correctif, ce fichier de routes n'avait aucune validation : un nom/description de mauvais
// type ou un id d'URL non entier/hors bornes INT4 ressortait en 500, comme une panne interne. Ces cas
// sont désormais refusés en 400, sans écriture et sans entrée JournalErreur (erreur de saisie, pas
// une panne). Tous les autres comportements sont préservés à l'identique. Le modèle Prisma Depot
// (prisma/schema.prisma) déclare `nom String` (requis, non nul) et `description String?` (nullable),
// sans AUCUNE contrainte `@@unique` — vérifié par lecture du schéma, jamais présumé. DELETE est une
// suppression DOUCE (`actif: false`, commentaire explicite dans depots.ts) : le dépôt n'est jamais
// réellement supprimé, donc aucune violation de clé étrangère n'est jamais possible via cette route,
// quelles que soient les relations (Stock, MouvementStock, CommandeFournisseur, Production).
//
// Les pannes simulées ci-dessous ciblent une méthode Prisma réellement appelée par le handler visé
// (prisma.depot.create / .update / .updateMany), remplacée pour l'espace d'un seul test et restaurée
// dans un finally — PAS une interruption réseau/Postgres réelle, seulement une simulation confinée.
// Les entrées JournalErreur sont identifiées soit par un message unique (panne simulée), soit par
// interception confinée et restaurée de prisma.journalErreur.create (jamais par un comptage global
// route/fenêtre temporelle qui pourrait capturer une entrée créée par un autre fichier de test).

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
const depotIds: number[] = [];
const journalErreurIds: number[] = [];
const autresSocietes: { token: string; societeId: number }[] = [];

async function poster(body: unknown) {
  const reponse = await fetch(`${baseUrl}/api/depots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
}

async function modifier(id: number | string, body: unknown) {
  const reponse = await fetch(`${baseUrl}/api/depots/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
}

async function supprimer(id: number | string) {
  const reponse = await fetch(`${baseUrl}/api/depots/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const texte = await reponse.text();
  return { status: reponse.status, corps: texte ? JSON.parse(texte) : null };
}

async function creerDepotValide(nom?: string): Promise<{ id: number; nom: string; description: string | null }> {
  const r = await poster({ nom: nom ?? `DEPOTS CARACTERISATION ${randomUUID()}`, description: "fixture" });
  assert.equal(r.status, 201, `Création de dépôt (fixture) échouée : ${JSON.stringify(r.corps)}`);
  depotIds.push(r.corps.id);
  return r.corps;
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
  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
});

after(async () => {
  try {
    await prisma.journalErreur.deleteMany({ where: { id: { in: journalErreurIds } } });
    await prisma.stock.deleteMany({ where: { depotId: { in: depotIds } } });
    await prisma.depot.deleteMany({ where: { id: { in: depotIds } } });
    for (const autre of autresSocietes) {
      await prisma.depot.deleteMany({ where: { societeId: autre.societeId } });
      await prisma.utilisateur.deleteMany({ where: { societeId: autre.societeId } });
      await prisma.societe.deleteMany({ where: { id: autre.societeId } });
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

// --- A. POST /api/depots : cas valides et types de nom ---

test("[A1] POST valide : 201, nom et description tels quels", async () => {
  const nom = `DEPOTS CARACTERISATION A1 ${randomUUID()}`;
  const r = await poster({ nom, description: "une description" });
  assert.equal(r.status, 201);
  assert.equal(r.corps.nom, nom);
  assert.equal(r.corps.description, "une description");
  assert.equal(r.corps.actif, true);
  assert.equal(r.corps.societeId, societeId);
  depotIds.push(r.corps.id);
});

// Refus d'une saisie invalide en POST : exactement 400, rien committé (recherche par marqueur unique),
// aucune entrée JournalErreur (interception confinée de sa création).
async function verifierRefusPost(corpsEnvoye: unknown, rechercheMarqueur: { description: string } | { nom: string }) {
  const { resultat: r, entrees } = await avecInterceptionJournalisation(() => poster(corpsEnvoye));
  assert.equal(r.status, 400, "une saisie invalide doit être un refus 400, jamais un 500 ni un succès 201");
  assert.equal(r.corps.error, "Dépôt invalide");
  const cree = await prisma.depot.findFirst({ where: rechercheMarqueur });
  assert.equal(cree, null, "aucun dépôt ne doit être créé");
  assert.equal(entrees.length, 0, "une erreur de saisie n'est pas une panne : aucune entrée JournalErreur");
}

test("[A2] POST nom omis -> 400, rien committé, non journalisé", async () => {
  const marqueur = `DEPOTS CARACTERISATION A2 ${randomUUID()}`;
  await verifierRefusPost({ description: marqueur }, { description: marqueur });
});

test("[A3] POST nom explicitement null -> 400, rien committé, non journalisé", async () => {
  const marqueur = `DEPOTS CARACTERISATION A3 ${randomUUID()}`;
  await verifierRefusPost({ nom: null, description: marqueur }, { description: marqueur });
});

test("[A4] POST nom de type nombre -> 400, rien committé, non journalisé", async () => {
  const marqueur = `DEPOTS CARACTERISATION A4 ${randomUUID()}`;
  await verifierRefusPost({ nom: 12345, description: marqueur }, { description: marqueur });
});

test("[A5] POST nom de type tableau -> 400, rien committé, non journalisé", async () => {
  const marqueur = `DEPOTS CARACTERISATION A5 ${randomUUID()}`;
  await verifierRefusPost({ nom: ["a", "b"], description: marqueur }, { description: marqueur });
});

test("[A6] POST description de type nombre -> 400, rien committé, non journalisé", async () => {
  const nom = `DEPOTS CARACTERISATION A6 ${randomUUID()}`;
  await verifierRefusPost({ nom, description: 42 }, { nom });
});

// --- B. POST /api/depots : omission/null/vide de description (comportement, pas un défaut) ---

test("[B1] POST description omise -> 201, description vaut null (comportement observé, pas un défaut)", async () => {
  const nom = `DEPOTS CARACTERISATION B1 ${randomUUID()}`;
  const r = await poster({ nom });
  assert.equal(r.status, 201);
  assert.equal(r.corps.description, null);
  depotIds.push(r.corps.id);
});

test("[B2] POST description explicitement null -> 201, description vaut null", async () => {
  const nom = `DEPOTS CARACTERISATION B2 ${randomUUID()}`;
  const r = await poster({ nom, description: null });
  assert.equal(r.status, 201);
  assert.equal(r.corps.description, null);
  depotIds.push(r.corps.id);
});

test("[B3] POST description chaîne vide -> 201, description vaut null (depots.ts utilise `description || null`, pas `?? null` : la chaîne vide, falsy, est aussi convertie en null — comportement réellement exercé par le formulaire DepotForm.tsx quand le champ est laissé vide)", async () => {
  const nom = `DEPOTS CARACTERISATION B3 ${randomUUID()}`;
  const r = await poster({ nom, description: "" });
  assert.equal(r.status, 201);
  assert.equal(r.corps.description, null);
  depotIds.push(r.corps.id);
});

// --- C. PUT /api/depots/:id : nom/description ---

test("[C1] PUT valide : 200, nom et description mis à jour", async () => {
  const depot = await creerDepotValide();
  const nomModifie = `DEPOTS CARACTERISATION C1 MODIFIE ${randomUUID()}`;
  const r = await modifier(depot.id, { nom: nomModifie, description: "description modifiée" });
  assert.equal(r.status, 200);
  assert.equal(r.corps.nom, nomModifie);
  assert.equal(r.corps.description, "description modifiée");
});

test("[C2] PUT nom omis -> 200, nom CONSERVÉ (Prisma omet la clé `undefined`, comportement observé, pas un défaut, cohérent avec le précédent du chantier MENUS)", async () => {
  const depot = await creerDepotValide();
  const r = await modifier(depot.id, { description: "seule la description change" });
  assert.equal(r.status, 200);
  assert.equal(r.corps.nom, depot.nom, "le nom ne doit jamais être altéré quand la clé est absente du corps");
  assert.equal(r.corps.description, "seule la description change");
});

test("[C3] PUT description omise -> 200, description remise à null (comportement observé, pas un défaut — même mécanisme `||` que B1/B3)", async () => {
  const depot = await creerDepotValide();
  const r = await modifier(depot.id, { nom: depot.nom });
  assert.equal(r.status, 200);
  assert.equal(r.corps.description, null);
});

test("[C4] PUT nom explicitement null, avec tentative de description différente -> 400, dépôt intégralement inchangé (comparaison complète avant/après), non journalisé", async () => {
  const depot = await creerDepotValide();
  const avant = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });

  const descriptionTentee = `DEPOTS CARACTERISATION C4 TENTE ${randomUUID()}`;
  const { resultat: r, entrees } = await avecInterceptionJournalisation(() => modifier(depot.id, { nom: null, description: descriptionTentee }));
  assert.equal(r.status, 400, "un nom null doit être un refus 400, jamais un 500 ni un succès 200");
  assert.equal(r.corps.error, "Dépôt invalide");
  assert.equal(entrees.length, 0, "une erreur de saisie n'est pas une panne : aucune entrée JournalErreur");

  const apres = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });
  assert.deepEqual(apres, avant, "le dépôt complet doit rester strictement identique après ce refus");
});

test("[C5] PUT nom de type nombre, avec tentative de description différente -> 400, dépôt intégralement inchangé, non journalisé", async () => {
  const depot = await creerDepotValide();
  const avant = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });

  const { resultat: r, entrees } = await avecInterceptionJournalisation(() => modifier(depot.id, { nom: 12345, description: `DEPOTS CARACTERISATION C5 TENTE ${randomUUID()}` }));
  assert.equal(r.status, 400);
  assert.equal(r.corps.error, "Dépôt invalide");
  assert.equal(entrees.length, 0);

  const apres = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });
  assert.deepEqual(apres, avant);
});

// --- D. PUT /api/depots/:id : identifiants ---

test("[D1] PUT id non numérique (\"abc\") -> 400, dépôt réel distinct intégralement inchangé, non journalisé", async () => {
  const depot = await creerDepotValide();
  const avant = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });

  const { resultat: r, entrees } = await avecInterceptionJournalisation(() => modifier("abc", { nom: "peu importe", description: "peu importe" }));
  assert.equal(r.status, 400, "un id d'URL non numérique doit être un refus 400, jamais un 500");
  assert.equal(r.corps.error, "Identifiant de dépôt invalide");
  assert.equal(entrees.length, 0);

  const apres = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });
  assert.deepEqual(apres, avant, "aucun dépôt réel ne doit être affecté par un id d'URL invalide");
});

test("[D2] PUT id hors bornes INT4 -> 400, non journalisé", async () => {
  const { resultat: r, entrees } = await avecInterceptionJournalisation(() => modifier("999999999999999999999", { nom: "peu importe", description: "peu importe" }));
  assert.equal(r.status, 400, "un id hors bornes INT4 doit être un refus 400, jamais un 500");
  assert.equal(r.corps.error, "Identifiant de dépôt invalide");
  assert.equal(entrees.length, 0);
});

test("[D2b] PUT id non entier (\"1.5\") -> 400", async () => {
  const r = await modifier("1.5", { nom: "peu importe", description: "peu importe" });
  assert.equal(r.status, 400);
  assert.equal(r.corps.error, "Identifiant de dépôt invalide");
});

test("[D3] PUT id représentable mais inexistant -> 404 (comportement déjà correct)", async () => {
  const r = await modifier(999999999, { nom: "peu importe", description: "peu importe" });
  assert.equal(r.status, 404);
  assert.equal(r.corps.error, "Dépôt introuvable");
});

test("[D4] PUT sur un dépôt d'une autre société -> 404, et tentative d'un nom différent : le dépôt de l'autre société reste intégralement inchangé", async () => {
  const autre = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  autresSocietes.push(autre);
  const depotAutreSociete = await prisma.depot.create({ data: { nom: `DEPOTS CARACTERISATION D4 AUTRE SOCIETE ${randomUUID()}`, societeId: autre.societeId } });
  const avant = await prisma.depot.findUniqueOrThrow({ where: { id: depotAutreSociete.id } });

  const nomTente = `DEPOTS CARACTERISATION D4 TENTE ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/depots/${depotAutreSociete.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nom: nomTente, description: "tentative" }),
  });
  assert.equal(reponse.status, 404, "le dépôt d'une autre société ne doit jamais être modifiable en devinant son id");

  const apres = await prisma.depot.findUniqueOrThrow({ where: { id: depotAutreSociete.id } });
  assert.deepEqual(apres, avant, "le dépôt d'une autre société doit rester strictement identique après cette tentative");
});

// --- E. DELETE /api/depots/:id : identifiants et isolation ---

test("[E1] DELETE id non numérique -> 400, aucun dépôt réel affecté, non journalisé", async () => {
  const depot = await creerDepotValide();
  const avant = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });

  const { resultat: r, entrees } = await avecInterceptionJournalisation(() => supprimer("abc"));
  assert.equal(r.status, 400, "un id d'URL non numérique doit être un refus 400, jamais un 500");
  assert.equal(r.corps.error, "Identifiant de dépôt invalide");
  assert.equal(entrees.length, 0);

  const apres = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });
  assert.deepEqual(apres, avant, "le dépôt réel doit rester présent, actif et intégralement inchangé");
});

test("[E2] DELETE id hors bornes INT4 -> 400, non journalisé", async () => {
  const { resultat: r, entrees } = await avecInterceptionJournalisation(() => supprimer("999999999999999999999"));
  assert.equal(r.status, 400, "un id hors bornes INT4 doit être un refus 400, jamais un 500");
  assert.equal(r.corps.error, "Identifiant de dépôt invalide");
  assert.equal(entrees.length, 0);
});

test("[E3] DELETE id représentable mais inexistant -> 404 (comportement déjà correct)", async () => {
  const r = await supprimer(999999999);
  assert.equal(r.status, 404);
  assert.equal(r.corps.error, "Dépôt introuvable");
});

test("[E4] DELETE sur un dépôt d'une autre société -> 404, le dépôt de l'autre société reste présent et actif", async () => {
  const autre = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  autresSocietes.push(autre);
  const depotAutreSociete = await prisma.depot.create({ data: { nom: `DEPOTS CARACTERISATION E4 AUTRE SOCIETE ${randomUUID()}`, societeId: autre.societeId } });

  const r = await supprimer(depotAutreSociete.id);
  assert.equal(r.status, 404, "le dépôt d'une autre société ne doit jamais être supprimable en devinant son id");

  const apres = await prisma.depot.findUniqueOrThrow({ where: { id: depotAutreSociete.id } });
  assert.equal(apres.actif, true, "le dépôt d'une autre société ne doit jamais être désactivé par cette tentative");
});

// --- F. DELETE /api/depots/:id : suppression douce et relations ---

test("[F1] DELETE valide : 204, le dépôt reste présent en base avec actif=false (suppression DOUCE, pas une vraie suppression)", async () => {
  const depot = await creerDepotValide();
  const r = await supprimer(depot.id);
  assert.equal(r.status, 204);

  const relu = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });
  assert.equal(relu.actif, false, "le dépôt doit rester en base, seulement marqué inactif");
  assert.equal(relu.nom, depot.nom, "aucun autre champ ne doit être altéré par la suppression");
});

test("[F2] DELETE d'un dépôt référencé par un Stock : la ligne Stock reste intacte (aucune violation de clé étrangère possible, la suppression est douce)", async () => {
  const categorie = (await prisma.categorie.findFirst({ where: { societeId } })) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  const article = await prisma.article.create({
    data: {
      nom: `DEPOTS CARACTERISATION F2 Article ${randomUUID()}`,
      reference: `CARAC-DEPOTS-${randomUUID()}`,
      type: "MATIERE_PREMIERE",
      categorieId: categorie.id,
      tvaId: tva.id,
      societeId,
      rendement: 100,
      actif: true,
    },
  });

  const depot = await creerDepotValide();
  const stock = await prisma.stock.create({ data: { articleId: article.id, depotId: depot.id, quantite: 42 } });

  const r = await supprimer(depot.id);
  assert.equal(r.status, 204);

  const stockRelu = await prisma.stock.findUniqueOrThrow({ where: { id: stock.id } });
  assert.equal(stockRelu.quantite, 42, "la ligne Stock référençant ce dépôt doit rester intacte après la suppression douce");
  const depotRelu = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });
  assert.equal(depotRelu.actif, false);

  await prisma.stock.deleteMany({ where: { id: stock.id } });
  await prisma.article.deleteMany({ where: { id: article.id } });
});

// --- G. Pannes simulées confinées, une par opération Prisma réellement appelée ---

test("[G1] Panne simulée sur prisma.depot.create (POST) — PAS une interruption réseau/Postgres réelle : 500 générique, journalisée avec message unique et contexte attendu", async () => {
  const messageUnique = `PANNE_DEPOTS_CREATE_${randomUUID()}`;
  const original = prisma.depot.create;
  let r: { status: number; corps: unknown };
  let entrees: JournalErreur[];
  try {
    const interception = await avecInterceptionJournalisation(async () => {
      // @ts-expect-error — remplacement volontaire et confiné à ce test, restauré ci-dessous dans
      // le finally AVANT toute assertion : une assertion qui échouerait plus bas ne peut donc
      // jamais empêcher cette restauration.
      prisma.depot.create = async () => {
        throw new Error(messageUnique);
      };
      return poster({ nom: `DEPOTS CARACTERISATION G1 ${randomUUID()}`, description: "x" });
    });
    r = interception.resultat;
    entrees = interception.entrees;
  } finally {
    prisma.depot.create = original;
  }

  assert.equal(r.status, 500);
  assert.deepEqual(r.corps, { error: "Impossible de créer le dépôt" }, "message générique attendu, jamais le message brut de l'exception");
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].message, messageUnique);
  assert.equal(entrees[0].origine, "SERVEUR");
  assert.equal(entrees[0].route, "/api/depots");
  assert.equal(entrees[0].statutHttp, 500);
  assert.equal(entrees[0].societeId, societeId);
});

test("[G2] Panne simulée sur prisma.depot.update (PUT) — PAS une interruption réseau/Postgres réelle : 500 générique, journalisée avec message unique, dépôt intégralement inchangé", async () => {
  const depot = await creerDepotValide();
  const avant = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });

  const messageUnique = `PANNE_DEPOTS_UPDATE_${randomUUID()}`;
  const original = prisma.depot.update;
  let r: { status: number; corps: unknown };
  let entrees: JournalErreur[];
  try {
    const interception = await avecInterceptionJournalisation(async () => {
      // @ts-expect-error — remplacement volontaire et confiné à ce test, restauré ci-dessous.
      prisma.depot.update = async () => {
        throw new Error(messageUnique);
      };
      return modifier(depot.id, { nom: "tentative", description: "tentative" });
    });
    r = interception.resultat;
    entrees = interception.entrees;
  } finally {
    prisma.depot.update = original;
  }

  assert.equal(r.status, 500);
  assert.deepEqual(r.corps, { error: "Impossible de modifier le dépôt" });
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].message, messageUnique);
  assert.equal(entrees[0].route, "/api/depots/" + depot.id);
  assert.equal(entrees[0].statutHttp, 500);

  const apres = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });
  assert.deepEqual(apres, avant, "le dépôt doit rester strictement identique après cette panne simulée");
});

test("[G3] Panne simulée sur prisma.depot.updateMany (DELETE) — PAS une interruption réseau/Postgres réelle : 500 générique, journalisée avec message unique, dépôt resté actif", async () => {
  const depot = await creerDepotValide();

  const messageUnique = `PANNE_DEPOTS_UPDATEMANY_${randomUUID()}`;
  const original = prisma.depot.updateMany;
  let r: { status: number; corps: unknown };
  let entrees: JournalErreur[];
  try {
    const interception = await avecInterceptionJournalisation(async () => {
      // @ts-expect-error — remplacement volontaire et confiné à ce test, restauré ci-dessous.
      prisma.depot.updateMany = async () => {
        throw new Error(messageUnique);
      };
      return supprimer(depot.id);
    });
    r = interception.resultat;
    entrees = interception.entrees;
  } finally {
    prisma.depot.updateMany = original;
  }

  assert.equal(r.status, 500);
  assert.deepEqual(r.corps, { error: "Impossible de supprimer le dépôt" });
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].message, messageUnique);
  assert.equal(entrees[0].route, "/api/depots/" + depot.id);
  assert.equal(entrees[0].statutHttp, 500);

  const apres = await prisma.depot.findUniqueOrThrow({ where: { id: depot.id } });
  assert.equal(apres.actif, true, "la panne simulée doit empêcher toute désactivation du dépôt");
});
