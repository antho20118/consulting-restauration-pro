import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre POST /api/recettes/import-excel et GET
// /api/recettes/toutes-pour-correspondance (app Express réelle, vrai Postgres) — voir
// tests/unit/recettes.test.ts pour le même principe appliqué aux routes existantes.
//
// Règle absolue vérifiée ici : une mise à jour par cet import ne touche JAMAIS RecetteEtape ni
// aucun autre champ de la recette (nom, instructions, photo, categorieId, sousCategorieId,
// portions, poidsPortionG, poidsAccompagnementG, prixVenteHT, actif, createdAt, id) — seule sa
// table RecetteLigne est remplacée. Contrairement à PUT /:id (remplacement total, voir son propre
// test dans recettes.test.ts), cette route est conçue pour ne jamais pouvoir supprimer une
// technique de réalisation déjà saisie.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let categorieRecetteId: number;
let tvaId: number;
let fournisseurId: number;
let conditionnementId: number;
let uniteKgId: number;
let articleAId: number;
let articleBId: number;
const recetteIds: number[] = [];

async function creerArticleAvecTarif(nom: string, reference: string, prixHT: number) {
  const article = await prisma.article.create({
    data: {
      nom,
      reference,
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      actif: true,
    },
  });
  await prisma.tarifArticle.create({
    data: {
      articleId: article.id,
      fournisseurId,
      uniteId: uniteKgId,
      conditionnementId,
      quantiteConditionnement: 1,
      prixHT,
      actif: true,
    },
  });
  return article.id;
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
  const categorieRecette =
    (await prisma.categorieRecette.findFirst()) ??
    (await prisma.categorieRecette.create({ data: { nom: "Catégorie recette de test" } }));
  categorieRecetteId = categorieRecette.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const fournisseur = await prisma.fournisseur.create({ data: { nom: "Fournisseur test import-excel", societeId } });
  fournisseurId = fournisseur.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));
  conditionnementId = conditionnement.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;

  articleAId = await creerArticleAvecTarif("IMPORT EXCEL TEST article A", "IMPORTEXCEL-A", 10);
  articleBId = await creerArticleAvecTarif("IMPORT EXCEL TEST article B", "IMPORTEXCEL-B", 25);
});

after(async () => {
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  await prisma.recette.deleteMany({ where: { nom: { startsWith: "IMPORT EXCEL TEST" } } });
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: [articleAId, articleBId] } } });
  await prisma.article.deleteMany({ where: { id: { in: [articleAId, articleBId] } } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

test("GET /toutes-pour-correspondance retourne les recettes actives ET inactives", async () => {
  const creation = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      nom: "IMPORT EXCEL TEST recette inactive",
      societeId,
      categorieId: categorieRecetteId,
      portions: 4,
      lignes: [{ articleId: articleAId, quantite: 1, uniteId: uniteKgId }],
      etapes: [],
    }),
  });
  const recette = await creation.json();
  recetteIds.push(recette.id);
  await fetch(`${baseUrl}/api/recettes/${recette.id}`, { method: "DELETE", headers: authHeaders() });

  const reponse = await fetch(`${baseUrl}/api/recettes/toutes-pour-correspondance`, {
    headers: authHeaders(),
  });
  assert.equal(reponse.status, 200);
  const toutes = await reponse.json();
  const trouvee = toutes.find((r: { id: number }) => r.id === recette.id);
  assert.ok(trouvee, "la recette désactivée doit apparaître dans la liste de correspondance");
  assert.equal(trouvee.actif, false);
});

test("TEST CRITIQUE — mise à jour : étapes/HACCP/notes/photo/id strictement conservés, ingrédients remplacés, coût recalculé", async () => {
  const photoOriginale = "data:image/png;base64,AAAA";
  const creation = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      nom: "IMPORT EXCEL TEST recette critique",
      societeId,
      categorieId: categorieRecetteId,
      portions: 4,
      instructions: "Note originale à préserver.",
      photo: photoOriginale,
      lignes: [{ articleId: articleAId, quantite: 2, uniteId: uniteKgId }],
      etapes: [
        { description: "Étape 1 : préparer les légumes.", pointCritiqueHACCP: false, controleHACCP: null },
        {
          description: "Étape 2 : refroidir rapidement.",
          pointCritiqueHACCP: true,
          controleHACCP: "Refroidir de +63°C à +3°C en moins de 2h.",
        },
      ],
    }),
  });
  assert.equal(creation.status, 201);
  const avant = await creation.json();
  recetteIds.push(avant.id);

  const avantEnBase = await prisma.recette.findUniqueOrThrow({
    where: { id: avant.id },
    include: { etapes: true, lignes: true },
  });
  assert.equal(avantEnBase.etapes.length, 2);
  assert.equal(avantEnBase.lignes.length, 1);

  // Nouvelle version des ingrédients (autre article, autre quantité) — coût attendu : 3 × 25 = 75.
  const miseAJour = await fetch(`${baseUrl}/api/recettes/import-excel`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      decisions: [
        {
          action: "mettre_a_jour",
          recetteId: avant.id,
          lignes: [{ articleId: articleBId, quantite: 3, uniteId: uniteKgId }],
        },
      ],
    }),
  });
  assert.equal(miseAJour.status, 200);
  const reponseImport = await miseAJour.json();
  assert.equal(reponseImport.simulate, false);
  assert.equal(reponseImport.resultats.length, 1);
  assert.equal(reponseImport.resultats[0].action, "mettre_a_jour");
  assert.equal(reponseImport.resultats[0].recette.coutTotal, 75, "coût recalculé via calculerCoutRecette, pas une formule séparée");

  const apresEnBase = await prisma.recette.findUniqueOrThrow({
    where: { id: avant.id },
    include: { etapes: { orderBy: { ordre: "asc" } }, lignes: true },
  });

  // Identité de la recette
  assert.equal(apresEnBase.id, avant.id, "même ID — jamais une deuxième recette créée");
  assert.equal(apresEnBase.createdAt.getTime(), avantEnBase.createdAt.getTime());

  // Étapes strictement identiques (contenu ET ordre)
  assert.equal(apresEnBase.etapes.length, 2);
  assert.equal(apresEnBase.etapes[0].description, "Étape 1 : préparer les légumes.");
  assert.equal(apresEnBase.etapes[0].pointCritiqueHACCP, false);
  assert.equal(apresEnBase.etapes[0].controleHACCP, null);
  assert.equal(apresEnBase.etapes[1].description, "Étape 2 : refroidir rapidement.");
  assert.equal(apresEnBase.etapes[1].pointCritiqueHACCP, true, "point critique HACCP strictement inchangé");
  assert.equal(
    apresEnBase.etapes[1].controleHACCP,
    "Refroidir de +63°C à +3°C en moins de 2h.",
    "contrôle HACCP strictement inchangé"
  );
  // Les ID des étapes eux-mêmes sont inchangés : preuve que RecetteEtape n'a subi ni delete ni recreate.
  assert.equal(apresEnBase.etapes[0].id, avantEnBase.etapes[0].id);
  assert.equal(apresEnBase.etapes[1].id, avantEnBase.etapes[1].id);

  // Notes et photo strictement conservées
  assert.equal(apresEnBase.instructions, "Note originale à préserver.");
  assert.equal(apresEnBase.photo, photoOriginale);
  assert.equal(apresEnBase.nom, "IMPORT EXCEL TEST recette critique");
  assert.equal(apresEnBase.categorieId, categorieRecetteId);
  assert.equal(apresEnBase.portions, 4);
  assert.equal(apresEnBase.actif, true);

  // updatedAt de la recette elle-même : jamais touché, puisque seule sa table RecetteLigne
  // (une relation enfant) est modifiée — aucune instruction UPDATE ne cible jamais la ligne Recette.
  assert.equal(
    apresEnBase.updatedAt.getTime(),
    avantEnBase.updatedAt.getTime(),
    "updatedAt de la recette ne doit pas changer : seules ses RecetteLigne sont remplacées"
  );

  // Ingrédients : nouvelles données présentes, anciennes remplacées
  assert.equal(apresEnBase.lignes.length, 1);
  assert.equal(apresEnBase.lignes[0].articleId, articleBId);
  assert.equal(apresEnBase.lignes[0].quantite, 3);
});

test("mise à jour avec un nom déjà existant : jamais de doublon, une seule recette au total", async () => {
  const nom = "IMPORT EXCEL TEST nom unique";
  const creation = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      nom,
      societeId,
      categorieId: categorieRecetteId,
      portions: 2,
      lignes: [{ articleId: articleAId, quantite: 1, uniteId: uniteKgId }],
      etapes: [{ description: "Étape à préserver.", pointCritiqueHACCP: false, controleHACCP: null }],
    }),
  });
  const recette = await creation.json();
  recetteIds.push(recette.id);

  const avant = await prisma.recette.count({ where: { nom } });
  assert.equal(avant, 1);

  await fetch(`${baseUrl}/api/recettes/import-excel`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      decisions: [
        { action: "mettre_a_jour", recetteId: recette.id, lignes: [{ articleId: articleBId, quantite: 5, uniteId: uniteKgId }] },
      ],
    }),
  });

  const apres = await prisma.recette.count({ where: { nom } });
  assert.equal(apres, 1, "toujours une seule recette portant ce nom après import — jamais un doublon");

  const etapes = await prisma.recetteEtape.findMany({ where: { recetteId: recette.id } });
  assert.equal(etapes.length, 1);
  assert.equal(etapes[0].description, "Étape à préserver.");
});

test("simulate: true calcule le coût via calculerCoutRecette mais ne conserve rien en base", async () => {
  const creation = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      nom: "IMPORT EXCEL TEST simulation",
      societeId,
      categorieId: categorieRecetteId,
      portions: 1,
      lignes: [{ articleId: articleAId, quantite: 1, uniteId: uniteKgId }],
      etapes: [],
    }),
  });
  const recette = await creation.json();
  recetteIds.push(recette.id);

  const avant = await prisma.recetteLigne.findMany({ where: { recetteId: recette.id } });

  const apercu = await fetch(`${baseUrl}/api/recettes/import-excel`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      simulate: true,
      decisions: [
        { action: "mettre_a_jour", recetteId: recette.id, lignes: [{ articleId: articleBId, quantite: 4, uniteId: uniteKgId }] },
      ],
    }),
  });
  assert.equal(apercu.status, 200);
  const reponseApercu = await apercu.json();
  assert.equal(reponseApercu.simulate, true);
  assert.equal(reponseApercu.resultats[0].recette.coutTotal, 100, "4 × 25 = 100, calculé réellement via calculerCoutRecette");

  const apres = await prisma.recetteLigne.findMany({ where: { recetteId: recette.id } });
  assert.deepEqual(
    apres.map((l) => ({ articleId: l.articleId, quantite: l.quantite })),
    avant.map((l) => ({ articleId: l.articleId, quantite: l.quantite })),
    "simulate: true ne doit rien avoir conservé en base"
  );
});

test("création (aucune correspondance) : une seule recette créée, sans étape", async () => {
  const nom = "IMPORT EXCEL TEST creation via import";
  const avant = await prisma.recette.count({ where: { nom } });
  assert.equal(avant, 0);

  const reponse = await fetch(`${baseUrl}/api/recettes/import-excel`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      decisions: [
        {
          action: "creer",
          nom,
          categorieId: categorieRecetteId,
          sousCategorieId: null,
          societeId,
          lignes: [{ articleId: articleAId, quantite: 2, uniteId: uniteKgId }],
        },
      ],
    }),
  });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.resultats[0].action, "creer");
  recetteIds.push(corps.resultats[0].recette.id);

  const apres = await prisma.recette.count({ where: { nom } });
  assert.equal(apres, 1, "aucune duplication");

  const enBase = await prisma.recette.findUniqueOrThrow({
    where: { id: corps.resultats[0].recette.id },
    include: { etapes: true },
  });
  assert.equal(enBase.etapes.length, 0, "une recette créée par cet import n'a par nature aucune étape");
});

test("ATOMICITÉ — une décision invalide dans le lot annule tout le lot (rollback complet)", async () => {
  const nom = "IMPORT EXCEL TEST rollback";
  const creation = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      nom,
      societeId,
      categorieId: categorieRecetteId,
      portions: 1,
      lignes: [{ articleId: articleAId, quantite: 1, uniteId: uniteKgId }],
      etapes: [{ description: "Étape jamais supprimée si rollback.", pointCritiqueHACCP: false, controleHACCP: null }],
    }),
  });
  const recette = await creation.json();
  recetteIds.push(recette.id);

  const avantLignes = await prisma.recetteLigne.findMany({ where: { recetteId: recette.id } });
  const avantEtapes = await prisma.recetteEtape.findMany({ where: { recetteId: recette.id } });
  const nomCreationAvant = "IMPORT EXCEL TEST rollback creation qui echoue";
  const avantCreations = await prisma.recette.count({ where: { nom: nomCreationAvant } });
  assert.equal(avantCreations, 0);

  const idInexistant = 987654321;
  const reponse = await fetch(`${baseUrl}/api/recettes/import-excel`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      decisions: [
        // Une mise à jour valide, qui serait appliquée AVANT l'échec si le lot n'était pas atomique.
        { action: "mettre_a_jour", recetteId: recette.id, lignes: [{ articleId: articleBId, quantite: 9, uniteId: uniteKgId }] },
        // Une création qui réussirait aussi isolément...
        {
          action: "creer",
          nom: nomCreationAvant,
          categorieId: categorieRecetteId,
          sousCategorieId: null,
          societeId,
          lignes: [{ articleId: articleAId, quantite: 1, uniteId: uniteKgId }],
        },
        // ...mais la 3e décision référence une recette inexistante : toute la transaction doit
        // être annulée, y compris les deux décisions précédentes déjà exécutées dans ce même lot.
        { action: "mettre_a_jour", recetteId: idInexistant, lignes: [] },
      ],
    }),
  });
  assert.equal(reponse.status, 500);

  const apresLignes = await prisma.recetteLigne.findMany({ where: { recetteId: recette.id } });
  const apresEtapes = await prisma.recetteEtape.findMany({ where: { recetteId: recette.id } });
  assert.deepEqual(
    apresLignes.map((l) => ({ articleId: l.articleId, quantite: l.quantite })),
    avantLignes.map((l) => ({ articleId: l.articleId, quantite: l.quantite })),
    "la mise à jour valide du lot n'a pas dû être conservée : rollback complet"
  );
  assert.equal(apresEtapes.length, avantEtapes.length, "aucune étape supprimée par le rollback");

  const apresCreations = await prisma.recette.count({ where: { nom: nomCreationAvant } });
  assert.equal(apresCreations, 0, "la création valide du lot n'a pas dû être conservée non plus : rollback complet");
});

test("CONFLIT — deux décisions 'mettre_a_jour' visant la même recette : rejet explicite (400), aucune écriture, jamais un écrasement silencieux", async () => {
  // Cas réel identifié à l'audit : "SAUTE DE VEAU MARENGO" et "SAUTE DE VEAU AUX OLIVES"
  // correspondent chacune, individuellement, à l'unique recette existante "Saute de veau" — si
  // les deux étaient envoyées dans le même lot, la seconde écraserait silencieusement le résultat
  // de la première (même recetteId, deleteMany puis recreate exécutés en séquence).
  const nom = "IMPORT EXCEL TEST cible conflit";
  const creation = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      nom,
      societeId,
      categorieId: categorieRecetteId,
      portions: 1,
      lignes: [{ articleId: articleAId, quantite: 1, uniteId: uniteKgId }],
      etapes: [{ description: "Étape jamais touchée par un conflit rejeté.", pointCritiqueHACCP: false, controleHACCP: null }],
    }),
  });
  const recette = await creation.json();
  recetteIds.push(recette.id);

  const avantLignes = await prisma.recetteLigne.findMany({ where: { recetteId: recette.id } });

  const reponse = await fetch(`${baseUrl}/api/recettes/import-excel`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      decisions: [
        // "SAUTE DE VEAU MARENGO" -> même recette
        { action: "mettre_a_jour", recetteId: recette.id, lignes: [{ articleId: articleBId, quantite: 1, uniteId: uniteKgId }] },
        // "SAUTE DE VEAU AUX OLIVES" -> la même recette encore
        { action: "mettre_a_jour", recetteId: recette.id, lignes: [{ articleId: articleAId, quantite: 9, uniteId: uniteKgId }] },
      ],
    }),
  });
  assert.equal(reponse.status, 400, "rejet explicite et bloquant, jamais un écrasement silencieux");
  const corps = await reponse.json();
  assert.match(corps.error, /conflit/i);

  const apresLignes = await prisma.recetteLigne.findMany({ where: { recetteId: recette.id } });
  assert.deepEqual(
    apresLignes.map((l) => ({ articleId: l.articleId, quantite: l.quantite })),
    avantLignes.map((l) => ({ articleId: l.articleId, quantite: l.quantite })),
    "aucune des deux décisions en conflit n'a dû être appliquée"
  );
});
