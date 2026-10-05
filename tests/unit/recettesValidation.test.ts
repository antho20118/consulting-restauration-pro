import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";
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

  token = await connecterAdminDeTest(baseUrl);

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

// Régression F03 (audit du 2026-10-01) : aucune protection serveur contre les doublons de nom de
// recette, malgré un avertissement côté client (RecetteForm.tsx) trivialement contournable par un
// appel API direct. Les tests suivants vérifient le correctif (recalcul serveur, scopé par
// société, confirmable explicitement via confirmerDoublon).

test("16. [F03] POST avec un nom déjà utilisé par une recette active : refus (409), aucune écriture", async () => {
  const premiere = await creerRecette(payloadBase("RECETTE VALIDATION TEST Doublon"));
  assert.equal(premiere.status, 201);
  recetteIds.push(premiere.corps.id);

  const avant = await prisma.recette.count();
  const { status, corps } = await creerRecette(payloadBase("RECETTE VALIDATION TEST Doublon"));
  assert.equal(status, 409);
  assert.equal(corps.error, "Une recette portant ce nom existe déjà");
  assert.equal(corps.doublons.length, 1);
  assert.equal(corps.doublons[0].id, premiere.corps.id);
  const apres = await prisma.recette.count();
  assert.equal(apres, avant, "aucune seconde recette ne doit avoir été créée");
});

test("17. [F03] POST avec confirmerDoublon=true : le doublon est créé malgré tout", async () => {
  const premiere = await creerRecette(payloadBase("RECETTE VALIDATION TEST Doublon Confirme"));
  assert.equal(premiere.status, 201);
  recetteIds.push(premiere.corps.id);

  const { status, corps } = await creerRecette(
    payloadBase("RECETTE VALIDATION TEST Doublon Confirme", { confirmerDoublon: true })
  );
  assert.equal(status, 201);
  recetteIds.push(corps.id);
  assert.notEqual(corps.id, premiere.corps.id);

  const total = await prisma.recette.count({ where: { nom: "RECETTE VALIDATION TEST Doublon Confirme" } });
  assert.equal(total, 2);
});

test("18. [F03] la comparaison est insensible à la casse et aux espaces superflus", async () => {
  const premiere = await creerRecette(payloadBase("RECETTE VALIDATION TEST Casse"));
  assert.equal(premiere.status, 201);
  recetteIds.push(premiere.corps.id);

  const { status } = await creerRecette(payloadBase("  recette validation test casse  "));
  assert.equal(status, 409);
});

test("19. [F03] une recette DÉSACTIVÉE du même nom ne bloque jamais une nouvelle création", async () => {
  const premiere = await creerRecette(payloadBase("RECETTE VALIDATION TEST Inactive"));
  assert.equal(premiere.status, 201);
  recetteIds.push(premiere.corps.id);
  await prisma.recette.update({ where: { id: premiere.corps.id }, data: { actif: false } });

  const { status, corps } = await creerRecette(payloadBase("RECETTE VALIDATION TEST Inactive"));
  assert.equal(status, 201, "une recette désactivée n'est jamais un doublon bloquant");
  recetteIds.push(corps.id);
});

test("20. [F03] le contrôle est scopé par société : deux sociétés distinctes peuvent partager un nom", async () => {
  // Un VRAI second compte, rattaché à une AUTRE société, avec son propre jeton — un societeId
  // usurpé dans le corps n'aurait rien prouvé ici : il est de toute façon ignoré côté serveur
  // depuis le correctif F02, donc les deux appels auraient atterri dans LA MÊME société réelle
  // (celle du compte "admin") et auraient dû entrer en collision à juste titre.
  const autreSociete = await prisma.societe.create({ data: { nom: "RECETTE VALIDATION TEST Autre Société" } });
  const identifiantAutre = "recette-validation-test-autre-societe";
  await prisma.utilisateur.create({
    data: {
      identifiant: identifiantAutre,
      codeHache: hacherCode("1234"),
      role: "PROPRIETAIRE",
      societeId: autreSociete.id,
    },
  });
  try {
    const premiere = await creerRecette(payloadBase("RECETTE VALIDATION TEST Multi Société"));
    assert.equal(premiere.status, 201);
    recetteIds.push(premiere.corps.id);

    const connexionAutre = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiant: identifiantAutre, code: "1234" }),
    });
    const { token: tokenAutre } = await connexionAutre.json();

    const reponse = await fetch(`${baseUrl}/api/recettes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAutre}` },
      body: JSON.stringify(payloadBase("RECETTE VALIDATION TEST Multi Société", { societeId: autreSociete.id })),
    });
    assert.equal(reponse.status, 201, "même nom, mais dans une société réellement différente (JWT) — jamais un doublon cross-société");
    const corps = await reponse.json();

    await prisma.recette.delete({ where: { id: corps.id } });
  } finally {
    await prisma.utilisateur.delete({ where: { identifiant: identifiantAutre } });
    await prisma.societe.delete({ where: { id: autreSociete.id } });
  }
});

test("21. [F03] PUT : renommer SANS changer le nom (ou juste la casse/les espaces) ne se bloque jamais sur soi-même", async () => {
  const base = await creerRecette(payloadBase("RECETTE VALIDATION TEST Renommage Soi"));
  assert.equal(base.status, 201);
  recetteIds.push(base.corps.id);

  const { status } = await modifierRecette(
    base.corps.id,
    payloadBase("  recette validation test renommage soi  ")
  );
  assert.equal(status, 200, "une recette ne doit jamais être bloquée sur sa propre ligne");
});

test("22. [F03] PUT : renommer en collision avec une AUTRE recette active : refus (409), nom d'origine conservé", async () => {
  const cible = await creerRecette(payloadBase("RECETTE VALIDATION TEST Cible Existante"));
  assert.equal(cible.status, 201);
  recetteIds.push(cible.corps.id);

  const aRenommer = await creerRecette(payloadBase("RECETTE VALIDATION TEST A Renommer"));
  assert.equal(aRenommer.status, 201);
  recetteIds.push(aRenommer.corps.id);

  const { status, corps } = await modifierRecette(
    aRenommer.corps.id,
    payloadBase("RECETTE VALIDATION TEST Cible Existante")
  );
  assert.equal(status, 409);
  assert.equal(corps.doublons[0].id, cible.corps.id);

  const enBase = await prisma.recette.findUniqueOrThrow({ where: { id: aRenommer.corps.id } });
  assert.equal(enBase.nom, "RECETTE VALIDATION TEST A Renommer");
});
