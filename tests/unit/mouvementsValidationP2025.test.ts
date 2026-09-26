import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel (app Express réelle, vrai Postgres) pour le chantier « P2025,
// POST /mouvements » : un articleId ou depotId inexistant fait échouer les findUniqueOrThrow de
// server/routes/mouvements.ts avec le code Prisma P2025 — désormais refusé en 400 (traitement
// local à ce seul routeur, voir son commentaire), jamais en 500. Aucune écriture ne doit avoir
// lieu dans ces cas. Strictement indépendant du chantier P2003 (server/utils/erreursEcriture.ts,
// non modifié ici) : ce mécanisme est propre aux findUniqueOrThrow de ce routeur.
//
// Les comptages sont systématiquement filtrés sur le depot/article dédiés à ce fichier (jamais un
// comptage global) pour ne pas être exposés à la concurrence des autres fichiers de test exécutés
// en parallèle par `node --test` (voir l'audit du chantier P2003, qui a caractérisé précisément ce
// risque sur des comptages non filtrés).

const ID_INEXISTANT = 999999999;

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let depotTestId: number;
let articleTestId: number;

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function poster(corpsPayload: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/mouvements`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corpsPayload),
  });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
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

  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({
      data: { identifiant: "admin", codeHache: hacherCode("1234") },
    });
  }

  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: "admin", code: "1234" }),
  });
  assert.equal(reponseLogin.status, 200);
  token = (await reponseLogin.json()).token;

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;

  const depot = await prisma.depot.create({
    data: { nom: "P2025 MVT TEST Depot", societeId },
  });
  depotTestId = depot.id;

  const article = await prisma.article.create({
    data: {
      nom: "P2025 MVT TEST Article",
      reference: "P2025MVTTEST-001",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      type: "MATIERE_PREMIERE",
    },
  });
  articleTestId = article.id;
});

after(async () => {
  await prisma.mouvementStock.deleteMany({ where: { OR: [{ articleId: articleTestId }, { depotId: depotTestId }] } });
  await prisma.stock.deleteMany({ where: { OR: [{ articleId: articleTestId }, { depotId: depotTestId }] } });
  await prisma.article.delete({ where: { id: articleTestId } });
  await prisma.depot.delete({ where: { id: depotTestId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("1. POST /mouvements avec articleId inexistant : 400, message générique, aucune écriture", async () => {
  const { status, corps } = await poster({
    articleId: ID_INEXISTANT,
    depotId: depotTestId,
    type: "ENTREE",
    quantite: 5,
    motif: "P2025 MVT TEST cas 1",
  });

  assert.equal(status, 400);
  assert.equal(corps?.error, "Référence invalide : un champ désigne un enregistrement inexistant");

  const mouvements = await prisma.mouvementStock.findMany({ where: { depotId: depotTestId } });
  assert.equal(mouvements.length, 0, "aucun mouvement ne doit avoir été créé pour ce dépôt de test");
  const stocks = await prisma.stock.findMany({ where: { depotId: depotTestId } });
  assert.equal(stocks.length, 0, "aucun stock ne doit avoir été créé pour ce dépôt de test");
});

test("2. POST /mouvements avec depotId inexistant : 400, aucune écriture", async () => {
  const { status, corps } = await poster({
    articleId: articleTestId,
    depotId: ID_INEXISTANT,
    type: "ENTREE",
    quantite: 5,
    motif: "P2025 MVT TEST cas 2",
  });

  assert.equal(status, 400);
  assert.equal(corps?.error, "Référence invalide : un champ désigne un enregistrement inexistant");

  const mouvements = await prisma.mouvementStock.findMany({ where: { articleId: articleTestId } });
  assert.equal(mouvements.length, 0, "aucun mouvement ne doit avoir été créé pour cet article de test");
  const stocks = await prisma.stock.findMany({ where: { articleId: articleTestId } });
  assert.equal(stocks.length, 0, "aucun stock ne doit avoir été créé pour cet article de test");
});

test("3. POST /mouvements avec articleId ET depotId inexistants : 400 (premier P2025 rencontré = Article, traité identiquement)", async () => {
  const { status, corps } = await poster({
    articleId: ID_INEXISTANT,
    depotId: ID_INEXISTANT,
    type: "ENTREE",
    quantite: 5,
    motif: "P2025 MVT TEST cas 3",
  });

  assert.equal(status, 400);
  assert.equal(corps?.error, "Référence invalide : un champ désigne un enregistrement inexistant");

  // Aucun des deux IDs n'étant réel, un scoping par articleId/depotId dédié est impossible ici :
  // le motif (chaîne unique à ce test) sert de filtre pour rester indépendant des autres fichiers
  // de test exécutés en parallèle par `node --test`.
  const mouvements = await prisma.mouvementStock.findMany({
    where: { motif: { contains: "P2025 MVT TEST cas 3" } },
  });
  assert.equal(mouvements.length, 0, "aucun mouvement ne doit avoir été créé");
});

test("4. POST /mouvements avec des données valides : fonctionne normalement (mouvement créé, stock ajusté)", async () => {
  const { status, corps } = await poster({
    articleId: articleTestId,
    depotId: depotTestId,
    type: "ENTREE",
    quantite: 7,
    motif: "P2025 MVT TEST cas 4 valide",
  });

  assert.equal(status, 201);
  assert.equal(corps?.articleId, articleTestId);
  assert.equal(corps?.depotId, depotTestId);
  assert.equal(corps?.quantite, 7);

  const mouvementEnBase = await prisma.mouvementStock.findFirst({
    where: { articleId: articleTestId, depotId: depotTestId },
  });
  assert.ok(mouvementEnBase, "le mouvement doit être réellement présent en base");
  assert.equal(mouvementEnBase?.quantite, 7);

  const stockEnBase = await prisma.stock.findUnique({
    where: { articleId_depotId: { articleId: articleTestId, depotId: depotTestId } },
  });
  assert.ok(stockEnBase, "le stock doit être réellement créé en base");
  assert.equal(stockEnBase?.quantite, 7);
});

test("5. Non-régression : une erreur qui n'est PAS P2025 (octet NUL rejeté par Postgres) reste en 500, aucune écriture", async () => {
  // Déclencheur réel, sans modification de code de production : un octet NUL (\u0000) dans motif
  // (colonne texte) est rejeté par Postgres lui-même ("invalid byte sequence for encoding UTF8"),
  // ce qui produit un PrismaClientUnknownRequestError — jamais un PrismaClientKnownRequestError
  // code P2025 — confirmé empiriquement (voir caractérisation) : la branche 500 générique
  // existante doit donc rester empruntée, exactement comme avant ce chantier.
  const stockAvant = await prisma.stock.findUnique({
    where: { articleId_depotId: { articleId: articleTestId, depotId: depotTestId } },
  });

  const { status } = await poster({
    articleId: articleTestId,
    depotId: depotTestId,
    type: "ENTREE",
    quantite: 1,
    motif: "P2025 MVT TEST cas 5\u0000",
  });

  assert.equal(status, 500, "une erreur non-P2025 doit conserver le comportement 500 existant");

  const mouvements = await prisma.mouvementStock.findMany({
    where: { articleId: articleTestId, depotId: depotTestId, motif: { contains: "cas 5" } },
  });
  assert.equal(mouvements.length, 0, "aucun mouvement ne doit avoir été créé malgré la tentative");

  // Le stock.upsert a lieu AVANT le mouvementStock.create en échec, dans la même transaction
  // interactive : le rollback Prisma doit donc aussi annuler cet upsert, pas seulement empêcher la
  // création du mouvement — vérifié explicitement ici plutôt que supposé.
  const stockApres = await prisma.stock.findUnique({
    where: { articleId_depotId: { articleId: articleTestId, depotId: depotTestId } },
  });
  assert.equal(
    stockApres?.quantite,
    stockAvant?.quantite,
    "le stock ne doit pas avoir été modifié par la tentative échouée (rollback complet de la transaction)"
  );
});
