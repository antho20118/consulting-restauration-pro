import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Mouvements de stock simultanés (server/utils/mouvementStock.ts) et réception/annulation d'une même
// commande en même temps (server/routes/commandes.ts), constat de l'audit du 15/10 : le stock était
// lu puis réécrit (mise à jour perdue entre deux requêtes simultanées) et l'état « en attente »
// d'une commande était vérifié hors transaction (une réception validée 3 fois en même temps — double
// clic, réseau lent — enregistrait 3 entrées de stock pour une seule réception). Société dédiée.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let depotId: number;
let fournisseurId: number;
let categorieId: number;
let tvaId: number;
const articleIds: number[] = [];

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  const marqueur = `STOCK-CONCURRENCE-${randomUUID()}`;
  societeId = (await prisma.societe.create({ data: { nom: marqueur } })).id;
  await prisma.utilisateur.create({
    data: { identifiant: marqueur, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId },
  });
  const connexion = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: marqueur, code: "1234" }),
  });
  token = ((await connexion.json()) as { token: string }).token;
  depotId = (await prisma.depot.create({ data: { nom: marqueur, societeId } })).id;
  fournisseurId = (
    // Avec un code : un fournisseur sans code serait repris par le script de rattrapage
    // (prisma/backfillCodeFournisseur.ts) testé en parallèle par codeFournisseurCreationAutomatique.
    await prisma.fournisseur.create({ data: { nom: marqueur, societeId, codeFournisseur: "FOU-TEST" } })
  ).id;
  categorieId = (await prisma.categorie.create({ data: { nom: marqueur, societeId } })).id;
  tvaId = (await prisma.tVA.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
});

after(async () => {
  try {
    const commandes = await prisma.commandeFournisseur.findMany({ where: { depotId }, select: { id: true } });
    await prisma.ligneCommandeFournisseur.deleteMany({ where: { commandeId: { in: commandes.map((c) => c.id) } } });
    await prisma.commandeFournisseur.deleteMany({ where: { depotId } });
    await prisma.mouvementStock.deleteMany({ where: { articleId: { in: articleIds } } });
    await prisma.stock.deleteMany({ where: { articleId: { in: articleIds } } });
    await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
    await prisma.categorie.deleteMany({ where: { societeId } });
    await prisma.fournisseur.deleteMany({ where: { societeId } });
    await prisma.depot.deleteMany({ where: { societeId } });
    await prisma.utilisateur.deleteMany({ where: { societeId } });
    await prisma.societe.deleteMany({ where: { id: societeId } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

async function nouvelArticle(): Promise<number> {
  const article = await prisma.article.create({
    data: { nom: `STOCK-CONCURRENCE ${randomUUID()}`, type: "MATIERE_PREMIERE", categorieId, tvaId, societeId },
  });
  articleIds.push(article.id);
  return article.id;
}

function poster(chemin: string, body: unknown) {
  return fetch(`${baseUrl}/api${chemin}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function stockDe(articleId: number): Promise<number | undefined> {
  return (await prisma.stock.findFirst({ where: { articleId, depotId } }))?.quantite;
}

async function enParallele(n: number, appel: () => Promise<Response>): Promise<number[]> {
  const reponses = await Promise.all(Array.from({ length: n }, appel));
  return reponses.map((r) => r.status).sort();
}

test("5 entrées simultanées sur un article encore sans stock : toutes comptées (50)", async () => {
  const articleId = await nouvelArticle();
  const statuts = await enParallele(5, () => poster("/mouvements", { articleId, depotId, type: "ENTREE", quantite: 10 }));
  assert.deepEqual(statuts, [201, 201, 201, 201, 201]);
  assert.equal(await stockDe(articleId), 50);
  assert.equal(await prisma.mouvementStock.count({ where: { articleId } }), 5);
});

test("5 sorties simultanées de 10 sur un stock de 50 : toutes comptées (stock 0)", async () => {
  const articleId = await nouvelArticle();
  await prisma.stock.create({ data: { articleId, depotId, quantite: 50 } });
  const statuts = await enParallele(5, () => poster("/mouvements", { articleId, depotId, type: "SORTIE", quantite: 10 }));
  assert.deepEqual(statuts, [201, 201, 201, 201, 201]);
  assert.equal(await stockDe(articleId), 0);
});

test("5 sorties simultanées de 10 sur un stock de 30 : exactement 3 acceptées, jamais de stock négatif", async () => {
  const articleId = await nouvelArticle();
  await prisma.stock.create({ data: { articleId, depotId, quantite: 30 } });
  const statuts = await enParallele(5, () => poster("/mouvements", { articleId, depotId, type: "SORTIE", quantite: 10 }));
  assert.deepEqual(statuts, [201, 201, 201, 400, 400]);
  assert.equal(await stockDe(articleId), 0);
  assert.equal(await prisma.mouvementStock.count({ where: { articleId } }), 3);
});

async function commandeEnAttente(articleId: number, quantiteBase: number) {
  return prisma.commandeFournisseur.create({
    data: {
      fournisseurId,
      depotId,
      lignes: {
        create: [{ articleId, conditionnementLibelle: "carton", conditionnements: 1, quantiteCommandeeBase: quantiteBase, prixUnitaireBase: 1 }],
      },
    },
    include: { lignes: true },
  });
}

test("une réception validée 3 fois en même temps n'est enregistrée qu'une fois (les autres : 409)", async () => {
  const articleId = await nouvelArticle();
  const commande = await commandeEnAttente(articleId, 30);
  const corps = { lignes: [{ ligneId: commande.lignes[0].id, quantiteRecueBase: 30 }] };
  const statuts = await enParallele(3, () => poster(`/commandes/${commande.id}/receptionner`, corps));
  assert.deepEqual(statuts, [200, 409, 409]);
  assert.equal(await stockDe(articleId), 30);
  assert.equal(await prisma.mouvementStock.count({ where: { articleId } }), 1);
  assert.equal((await prisma.commandeFournisseur.findUniqueOrThrow({ where: { id: commande.id } })).statut, "RECUE");
});

test("réception et annulation simultanées d'une même commande : une seule des deux aboutit, état cohérent", async () => {
  for (let essai = 0; essai < 5; essai++) {
    const articleId = await nouvelArticle();
    const commande = await commandeEnAttente(articleId, 20);
    const [reception, annulation] = await Promise.all([
      poster(`/commandes/${commande.id}/receptionner`, { lignes: [{ ligneId: commande.lignes[0].id, quantiteRecueBase: 20 }] }),
      poster(`/commandes/${commande.id}/annuler`, {}),
    ]);
    const statuts = [reception.status, annulation.status].sort();
    assert.deepEqual(statuts, [200, 409], `essai ${essai} : une seule opération doit aboutir`);
    const finale = await prisma.commandeFournisseur.findUniqueOrThrow({ where: { id: commande.id } });
    const mouvements = await prisma.mouvementStock.count({ where: { articleId } });
    if (finale.statut === "ANNULEE") {
      assert.equal(mouvements, 0, `essai ${essai} : commande annulée, aucune entrée de stock`);
      assert.equal(await stockDe(articleId), undefined);
    } else {
      assert.equal(finale.statut, "RECUE");
      assert.equal(mouvements, 1);
      assert.equal(await stockDe(articleId), 20);
    }
  }
});
