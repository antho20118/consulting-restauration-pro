import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Test d'intégration réel contre POST/GET /api/commandes (boucle achats complète, Phase 1 du plan
// d'action : commande enregistrée → réception → mise à jour stock). Mêmes fixtures que
// tests/unit/achats.test.ts (source unique de calcul, voir propositionAchat.ts).

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let conditionnementId: number;
let uniteKgId: number;
let depotId: number;
let articleId: number;
const commandeIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
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

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie =
    (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));
  conditionnementId = conditionnement.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "COMMANDES TEST Fournisseur", societeId } });
  fournisseurId = fournisseur.id;

  const depot = await prisma.depot.create({ data: { nom: "COMMANDES TEST Dépôt", societeId } });
  depotId = depot.id;

  const article = await prisma.article.create({
    data: {
      nom: "COMMANDES TEST Article",
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      actif: true,
    },
  });
  articleId = article.id;
  await prisma.tarifArticle.create({
    data: {
      articleId,
      fournisseurId,
      uniteId: uniteKgId,
      conditionnementId,
      quantiteConditionnement: 10,
      prixHT: 100,
      actif: true,
    },
  });
});

after(async () => {
  await prisma.mouvementStock.deleteMany({ where: { articleId } });
  await prisma.ligneCommandeFournisseur.deleteMany({ where: { commandeId: { in: commandeIds } } });
  await prisma.commandeFournisseur.deleteMany({ where: { id: { in: commandeIds } } });
  await prisma.stock.deleteMany({ where: { articleId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.deleteMany({ where: { id: articleId } });
  await prisma.depot.deleteMany({ where: { id: depotId } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("POST /commandes : enregistre une commande réelle (23kg -> 3 conditionnements de 10kg, 300€), sans toucher au stock", async () => {
  const stocksAvant = await prisma.stock.count({ where: { articleId } });

  const reponse = await fetch(`${baseUrl}/api/commandes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      depotId,
      besoins: [{ articleId, quantite: 23, facteurUniteRecette: 1000 }],
    }),
  });
  assert.equal(reponse.status, 201);
  const { commandes } = await reponse.json();
  assert.equal(commandes.length, 1);
  const commande = commandes[0];
  commandeIds.push(commande.id);

  assert.equal(commande.fournisseurId, fournisseurId);
  assert.equal(commande.depotId, depotId);
  assert.equal(commande.statut, "EN_ATTENTE");
  assert.equal(commande.dateReception, null);
  assert.equal(commande.lignes.length, 1);
  const ligne = commande.lignes[0];
  assert.equal(ligne.articleId, articleId);
  assert.equal(ligne.conditionnements, 3);
  assert.equal(ligne.quantiteCommandeeBase, 30000);
  assert.equal(ligne.quantiteRecueBase, null);
  // 100€ pour 10kg = 10000g (facteurBase du kg) -> 0,01€/g, l'unité de base ici.
  assert.equal(ligne.prixUnitaireBase, 0.01);

  // Aucune écriture de stock à la seule création de la commande (niveau « commande », pas encore
  // « réception »).
  assert.equal(await prisma.stock.count({ where: { articleId } }), stocksAvant);
});

test("POST /commandes : rien à commander (stock déjà suffisant) -> aucune commande créée", async () => {
  await prisma.stock.upsert({
    where: { articleId_depotId: { articleId, depotId } },
    update: { quantite: 999999 },
    create: { articleId, depotId, quantite: 999999 },
  });

  const reponse = await fetch(`${baseUrl}/api/commandes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ depotId, besoins: [{ articleId, quantite: 1, facteurUniteRecette: 1000 }] }),
  });
  assert.equal(reponse.status, 201);
  const { commandes } = await reponse.json();
  assert.equal(commandes.length, 0);

  await prisma.stock.update({ where: { articleId_depotId: { articleId, depotId } }, data: { quantite: 0 } });
});

test("refuse un corps de requête invalide (depotId manquant)", async () => {
  const reponse = await fetch(`${baseUrl}/api/commandes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ besoins: [{ articleId, quantite: 1, facteurUniteRecette: 1000 }] }),
  });
  assert.equal(reponse.status, 400);
});

test("GET /commandes et GET /commandes/:id renvoient la commande créée", async () => {
  const reponseListe = await fetch(`${baseUrl}/api/commandes`, { headers: authHeaders() });
  assert.equal(reponseListe.status, 200);
  const liste = await reponseListe.json();
  assert.ok(liste.some((c: { id: number }) => c.id === commandeIds[0]));

  const reponseDetail = await fetch(`${baseUrl}/api/commandes/${commandeIds[0]}`, { headers: authHeaders() });
  assert.equal(reponseDetail.status, 200);
  const detail = await reponseDetail.json();
  assert.equal(detail.id, commandeIds[0]);
  assert.equal(detail.fournisseur.nom, "COMMANDES TEST Fournisseur");
  assert.equal(detail.depot.nom, "COMMANDES TEST Dépôt");
});

test("GET /commandes/:id : 404 pour une commande inexistante", async () => {
  const reponse = await fetch(`${baseUrl}/api/commandes/999999999`, { headers: authHeaders() });
  assert.equal(reponse.status, 404);
});

test("réception complète : statut RECUE, mouvement ENTREE créé, stock mis à jour", async () => {
  const commande = await prisma.commandeFournisseur.create({
    data: {
      fournisseurId,
      depotId,
      lignes: {
        create: [
          {
            articleId,
            conditionnementLibelle: "Unité",
            conditionnements: 2,
            quantiteCommandeeBase: 20000,
            prixUnitaireBase: 10,
          },
        ],
      },
    },
    include: { lignes: true },
  });
  commandeIds.push(commande.id);
  const ligneId = commande.lignes[0].id;

  const stockAvant = (await prisma.stock.findUnique({ where: { articleId_depotId: { articleId, depotId } } }))?.quantite ?? 0;

  const reponse = await fetch(`${baseUrl}/api/commandes/${commande.id}/receptionner`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ lignes: [{ ligneId, quantiteRecueBase: 20000 }] }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();
  assert.equal(resultat.statut, "RECUE");
  assert.ok(resultat.dateReception);
  assert.equal(resultat.lignes[0].quantiteRecueBase, 20000);
  assert.ok(resultat.lignes[0].mouvementStockId);

  const stockApres = await prisma.stock.findUniqueOrThrow({ where: { articleId_depotId: { articleId, depotId } } });
  assert.equal(stockApres.quantite, stockAvant + 20000);

  const mouvement = await prisma.mouvementStock.findUniqueOrThrow({ where: { id: resultat.lignes[0].mouvementStockId } });
  assert.equal(mouvement.type, "ENTREE");
  assert.equal(mouvement.quantite, 20000);
  assert.match(mouvement.motif ?? "", new RegExp(`commande fournisseur #${commande.id}`, "i"));
});

test("réception partielle : statut RECUE_PARTIELLEMENT, mouvement limité à la quantité réellement reçue", async () => {
  const commande = await prisma.commandeFournisseur.create({
    data: {
      fournisseurId,
      depotId,
      lignes: {
        create: [
          {
            articleId,
            conditionnementLibelle: "Unité",
            conditionnements: 2,
            quantiteCommandeeBase: 20000,
            prixUnitaireBase: 10,
          },
        ],
      },
    },
    include: { lignes: true },
  });
  commandeIds.push(commande.id);
  const ligneId = commande.lignes[0].id;

  const reponse = await fetch(`${baseUrl}/api/commandes/${commande.id}/receptionner`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ lignes: [{ ligneId, quantiteRecueBase: 12000 }] }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();
  assert.equal(resultat.statut, "RECUE_PARTIELLEMENT");
  assert.equal(resultat.lignes[0].quantiteRecueBase, 12000);

  const mouvement = await prisma.mouvementStock.findUniqueOrThrow({ where: { id: resultat.lignes[0].mouvementStockId } });
  assert.equal(mouvement.quantite, 12000);
});

test("réception : aucun mouvement créé pour une ligne reçue à 0 (rupture totale sur cette ligne)", async () => {
  const commande = await prisma.commandeFournisseur.create({
    data: {
      fournisseurId,
      depotId,
      lignes: {
        create: [
          {
            articleId,
            conditionnementLibelle: "Unité",
            conditionnements: 1,
            quantiteCommandeeBase: 10000,
            prixUnitaireBase: 10,
          },
        ],
      },
    },
    include: { lignes: true },
  });
  commandeIds.push(commande.id);
  const ligneId = commande.lignes[0].id;

  const reponse = await fetch(`${baseUrl}/api/commandes/${commande.id}/receptionner`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ lignes: [{ ligneId, quantiteRecueBase: 0 }] }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();
  assert.equal(resultat.statut, "RECUE_PARTIELLEMENT");
  assert.equal(resultat.lignes[0].quantiteRecueBase, 0);
  assert.equal(resultat.lignes[0].mouvementStockId, null);
});

test("refuse de réceptionner une commande déjà traitée", async () => {
  const commande = await prisma.commandeFournisseur.create({
    data: {
      fournisseurId,
      depotId,
      statut: "RECUE",
      dateReception: new Date(),
      lignes: {
        create: [
          {
            articleId,
            conditionnementLibelle: "Unité",
            conditionnements: 1,
            quantiteCommandeeBase: 10000,
            prixUnitaireBase: 10,
            quantiteRecueBase: 10000,
          },
        ],
      },
    },
    include: { lignes: true },
  });
  commandeIds.push(commande.id);

  const reponse = await fetch(`${baseUrl}/api/commandes/${commande.id}/receptionner`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ lignes: [{ ligneId: commande.lignes[0].id, quantiteRecueBase: 10000 }] }),
  });
  assert.equal(reponse.status, 409);
});

test("refuse une réception qui ne couvre pas toutes les lignes de la commande", async () => {
  const commande = await prisma.commandeFournisseur.create({
    data: {
      fournisseurId,
      depotId,
      lignes: {
        create: [
          {
            articleId,
            conditionnementLibelle: "Unité",
            conditionnements: 1,
            quantiteCommandeeBase: 10000,
            prixUnitaireBase: 10,
          },
        ],
      },
    },
    include: { lignes: true },
  });
  commandeIds.push(commande.id);

  const reponse = await fetch(`${baseUrl}/api/commandes/${commande.id}/receptionner`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ lignes: [] }),
  });
  assert.equal(reponse.status, 400);

  const ligneRelue = await prisma.ligneCommandeFournisseur.findUniqueOrThrow({ where: { id: commande.lignes[0].id } });
  assert.equal(ligneRelue.quantiteRecueBase, null, "aucune écriture partielle malgré la requête refusée");
});

test("annule une commande EN_ATTENTE, refuse d'annuler une commande déjà reçue", async () => {
  const commande = await prisma.commandeFournisseur.create({
    data: { fournisseurId, depotId, lignes: { create: [] } },
  });
  commandeIds.push(commande.id);

  const reponseAnnulation = await fetch(`${baseUrl}/api/commandes/${commande.id}/annuler`, {
    method: "POST",
    headers: authHeaders(),
  });
  assert.equal(reponseAnnulation.status, 200);
  assert.equal((await reponseAnnulation.json()).statut, "ANNULEE");

  const reponseDouble = await fetch(`${baseUrl}/api/commandes/${commande.id}/annuler`, {
    method: "POST",
    headers: authHeaders(),
  });
  assert.equal(reponseDouble.status, 409, "une commande déjà annulée ne peut pas l'être une seconde fois");
});

test("401 sans authentification sur toutes les routes commandes", async () => {
  const reponses = await Promise.all([
    fetch(`${baseUrl}/api/commandes`),
    fetch(`${baseUrl}/api/commandes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    fetch(`${baseUrl}/api/commandes/${commandeIds[0]}`),
  ]);
  for (const reponse of reponses) assert.equal(reponse.status, 401);
});
