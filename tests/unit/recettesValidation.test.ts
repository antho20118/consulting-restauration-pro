import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre POST /api/recettes et PUT /api/recettes/:id (app Express réelle,
// vrai Postgres).
//
// Objet de ce chantier (caractérisation « validation serveur POST/PUT /recettes ») : un nom
// vide/composé uniquement d'espaces/trop long, un prixVenteHT négatif, ou un gainCuissonPct de
// ligne négatif ne doivent plus jamais être acceptés en écriture — refusés en 400, jamais en base.
// Les comportements déjà corrects (portions <= 0, lignes vides) doivent rester inchangés.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteId: number;
let articleId: number;
const recetteIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function payloadBase(nom: string, extra: Record<string, unknown> = {}) {
  return { nom, societeId, portions: 2, lignes: [], ...extra };
}

async function creerRecette(payload: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const corps = await reponse.json();
  return { status: reponse.status, corps };
}

async function modifierRecette(id: number, payload: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/recettes/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const corps = await reponse.json();
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
  const unite = await prisma.unite.findFirstOrThrow();
  uniteId = unite.id;

  const article = await prisma.article.create({
    data: {
      nom: "RECETTE VALIDATION TEST Article",
      reference: "RECVALIDTEST-001",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      type: "MATIERE_PREMIERE",
    },
  });
  articleId = article.id;
});

after(async () => {
  await prisma.recetteLigne.deleteMany({ where: { recetteId: { in: recetteIds } } });
  await prisma.recetteLigne.deleteMany({
    where: { recette: { nom: { startsWith: "RECETTE VALIDATION TEST" } } },
  });
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  await prisma.recette.deleteMany({ where: { nom: { startsWith: "RECETTE VALIDATION TEST" } } });
  await prisma.article.delete({ where: { id: articleId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("1. POST nom='' : refus (400), aucune écriture", async () => {
  const avant = await prisma.recette.count();
  const { status } = await creerRecette(payloadBase(""));
  assert.equal(status, 400);
  const apres = await prisma.recette.count();
  assert.equal(apres, avant, "aucune recette ne doit avoir été créée");
});

test("2. POST nom='   ' : refus (400), aucune écriture", async () => {
  const avant = await prisma.recette.count();
  const { status } = await creerRecette(payloadBase("   "));
  assert.equal(status, 400);
  const apres = await prisma.recette.count();
  assert.equal(apres, avant, "aucune recette ne doit avoir été créée");
});

test("3. PUT nom='' : refus (400), nom d'origine conservé", async () => {
  const base = await creerRecette(payloadBase("RECETTE VALIDATION TEST Nom Origine C"));
  recetteIds.push(base.corps.id);

  const { status } = await modifierRecette(base.corps.id, payloadBase(""));
  assert.equal(status, 400);

  const enBase = await prisma.recette.findUniqueOrThrow({ where: { id: base.corps.id } });
  assert.equal(enBase.nom, "RECETTE VALIDATION TEST Nom Origine C");
});

test("4. PUT nom='   ' : refus (400), nom d'origine conservé", async () => {
  const base = await creerRecette(payloadBase("RECETTE VALIDATION TEST Nom Origine D"));
  recetteIds.push(base.corps.id);

  const { status } = await modifierRecette(base.corps.id, payloadBase("   "));
  assert.equal(status, 400);

  const enBase = await prisma.recette.findUniqueOrThrow({ where: { id: base.corps.id } });
  assert.equal(enBase.nom, "RECETTE VALIDATION TEST Nom Origine D");
});

test("5. POST nom avec espaces superflus : accepté, nom trimé en base (non-régression)", async () => {
  const { status, corps } = await creerRecette(payloadBase("  RECETTE VALIDATION TEST Nom Espaces  "));
  assert.equal(status, 201);
  recetteIds.push(corps.id);
  assert.equal(corps.nom, "RECETTE VALIDATION TEST Nom Espaces");

  const enBase = await prisma.recette.findUniqueOrThrow({ where: { id: corps.id } });
  assert.equal(enBase.nom, "RECETTE VALIDATION TEST Nom Espaces");
});

test("6. POST prixVenteHT=-20 : refus (400), aucune écriture", async () => {
  const avant = await prisma.recette.count();
  const { status } = await creerRecette(payloadBase("RECETTE VALIDATION TEST PrixVente Negatif POST", { prixVenteHT: -20 }));
  assert.equal(status, 400);
  const apres = await prisma.recette.count();
  assert.equal(apres, avant, "aucune recette ne doit avoir été créée");
});

test("7. PUT prixVenteHT négatif : refus (400), valeur d'origine conservée", async () => {
  const base = await creerRecette(payloadBase("RECETTE VALIDATION TEST PrixVente Negatif PUT", { prixVenteHT: 15 }));
  recetteIds.push(base.corps.id);

  const { status } = await modifierRecette(
    base.corps.id,
    payloadBase("RECETTE VALIDATION TEST PrixVente Negatif PUT", { prixVenteHT: -30 })
  );
  assert.equal(status, 400);

  const enBase = await prisma.recette.findUniqueOrThrow({ where: { id: base.corps.id } });
  assert.equal(enBase.prixVenteHT, 15);
});

test("8. POST prixVenteHT=0 : accepté (non-régression)", async () => {
  const { status, corps } = await creerRecette(payloadBase("RECETTE VALIDATION TEST PrixVente Zero", { prixVenteHT: 0 }));
  assert.equal(status, 201);
  recetteIds.push(corps.id);
});

test("9. POST prixVenteHT=null : accepté, foodCostPct=null (non-régression)", async () => {
  const { status, corps } = await creerRecette(payloadBase("RECETTE VALIDATION TEST PrixVente Null", { prixVenteHT: null }));
  assert.equal(status, 201);
  recetteIds.push(corps.id);
  assert.equal(corps.prixVenteHT, null);
  assert.equal(corps.foodCostPct, null);
});

test("10. POST gainCuissonPct=-1 sur une ligne : refus (400), aucune écriture", async () => {
  const avant = await prisma.recette.count();
  const { status } = await creerRecette(
    payloadBase("RECETTE VALIDATION TEST GainCuisson Negatif POST", {
      lignes: [{ articleId, quantite: 5, uniteId, gainCuissonPct: -1 }],
    })
  );
  assert.equal(status, 400);
  const apres = await prisma.recette.count();
  assert.equal(apres, avant, "aucune recette ne doit avoir été créée");
});

test("11. PUT gainCuissonPct négatif sur une ligne : refus (400), valeur d'origine conservée", async () => {
  const base = await creerRecette(
    payloadBase("RECETTE VALIDATION TEST GainCuisson Negatif PUT", {
      lignes: [{ articleId, quantite: 5, uniteId, gainCuissonPct: 10 }],
    })
  );
  recetteIds.push(base.corps.id);

  const { status } = await modifierRecette(
    base.corps.id,
    payloadBase("RECETTE VALIDATION TEST GainCuisson Negatif PUT", {
      lignes: [{ articleId, quantite: 5, uniteId, gainCuissonPct: -5 }],
    })
  );
  assert.equal(status, 400);

  const enBase = await prisma.recetteLigne.findFirstOrThrow({ where: { recetteId: base.corps.id } });
  assert.equal(enBase.gainCuissonPct, 10, "la ligne d'origine ne doit pas avoir été remplacée");
});

test("12. POST gainCuissonPct=0 sur une ligne : accepté (non-régression, valeur par défaut)", async () => {
  const { status, corps } = await creerRecette(
    payloadBase("RECETTE VALIDATION TEST GainCuisson Zero", {
      lignes: [{ articleId, quantite: 5, uniteId, gainCuissonPct: 0 }],
    })
  );
  assert.equal(status, 201);
  recetteIds.push(corps.id);
});

test("13. POST gainCuissonPct=500 sur une ligne : accepté, aucune borne supérieure imposée", async () => {
  const { status, corps } = await creerRecette(
    payloadBase("RECETTE VALIDATION TEST GainCuisson Eleve", {
      lignes: [{ articleId, quantite: 5, uniteId, gainCuissonPct: 500 }],
    })
  );
  assert.equal(status, 201);
  recetteIds.push(corps.id);
  assert.equal(corps.lignes[0].gainCuissonPct, 500);
});

test("14. Non-régression : portions <= 0 toujours rejeté, transaction intégralement annulée", async () => {
  const avant = await prisma.recette.count();
  const { status } = await creerRecette(payloadBase("RECETTE VALIDATION TEST Portions Invalide", { portions: 0 }));
  assert.equal(status, 500, "comportement déjà correct et inchangé (voir calculerCoutRecette)");
  const apres = await prisma.recette.count();
  assert.equal(apres, avant, "aucune recette ne doit avoir été créée");
});

test("15. Non-régression : lignes=[] toujours accepté (choix produit)", async () => {
  const { status, corps } = await creerRecette(payloadBase("RECETTE VALIDATION TEST Lignes Vides"));
  assert.equal(status, 201);
  recetteIds.push(corps.id);
  assert.deepEqual(corps.lignes, []);
});
