import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Test d'intégration réel contre POST /api/articles/import et POST /api/articles/import/apercu
// (app Express réelle, vrai Postgres) — voir tests/unit/recettesImportExcel.test.ts pour le même
// principe appliqué à l'import de recettes.
//
// Objet de PR #79 vérifié ici : une correspondance approximative (similarité de désignation, sans
// référence identique) issue d'un listing fournisseur ne doit JAMAIS pouvoir clôturer le tarif
// actif d'un article existant et en ouvrir un nouveau sans une confirmation explicite du client
// portant sur CET article précis (articleId), réévaluée fraîchement côté serveur au moment de
// l'écriture — jamais un simple booléen global, jamais une confirmation transmise mais non
// revérifiée. Une correspondance par référence exacte continue, elle, son traitement automatique
// habituel, sans confirmation.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let fournisseurNom: string;
let conditionnementId: number;
let unitePieceId: number;
const articleIds: number[] = [];
const fournisseurIds: number[] = [];

async function creerArticleAvecTarif(
  nom: string,
  reference: string | null,
  prixHT: number,
  options?: { fournisseurId?: number }
) {
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
  const tarif = await prisma.tarifArticle.create({
    data: {
      articleId: article.id,
      fournisseurId: options?.fournisseurId ?? fournisseurId,
      uniteId: unitePieceId,
      conditionnementId,
      quantiteConditionnement: 1,
      prixHT,
      actif: true,
    },
  });
  articleIds.push(article.id);
  return { articleId: article.id, tarifId: tarif.id };
}

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function tarifActif(articleId: number) {
  return prisma.tarifArticle.findFirst({ where: { articleId, actif: true }, orderBy: { dateDebut: "desc" } });
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
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));
  conditionnementId = conditionnement.id;
  const unitePiece =
    (await prisma.unite.findFirst({ where: { symbole: { equals: "pièce", mode: "insensitive" } } })) ??
    (await prisma.unite.create({ data: { nom: "Pièce", symbole: "pièce", type: "piece", facteurBase: 1 } }));
  unitePieceId = unitePiece.id;

  fournisseurNom = "IMPORT LISTING TEST Fournisseur Défaut";
  const fournisseurDefaut = await prisma.fournisseur.create({ data: { nom: fournisseurNom, societeId } });
  fournisseurId = fournisseurDefaut.id;
  fournisseurIds.push(fournisseurId);
});

after(async () => {
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { nom: { startsWith: "IMPORT LISTING TEST" } } });
  await prisma.fournisseur.deleteMany({ where: { nom: { startsWith: "IMPORT LISTING TEST" } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

// A + J — aucune correspondance : création d'un nouvel article avec son tarif, comportement
// inchangé par rapport à avant PR #79.
test("A/J — aucune correspondance : crée un nouvel article et son tarif, visible en aperçu comme à l'import", async () => {
  const designation = "IMPORT LISTING TEST Nectarine Blanche Plateau";

  const apercu = await fetch(`${baseUrl}/api/articles/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      lignes: [{ designation, prix: "12.50" }],
    }),
  });
  assert.equal(apercu.status, 200);
  const corpsApercu = await apercu.json();
  assert.equal(corpsApercu.propositions.length, 1);
  assert.equal(corpsApercu.propositions[0].statut, "creation");
  assert.equal(corpsApercu.propositions[0].prixHT, 12.5);

  const avant = await prisma.article.count({ where: { nom: designation } });
  assert.equal(avant, 0);

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      lignes: [{ designation, prix: "12.50" }],
    }),
  });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.crees, 1);
  assert.equal(corps.misesAJour, 0);
  assert.equal(corps.enAttente, 0);

  const article = await prisma.article.findFirstOrThrow({ where: { nom: designation } });
  articleIds.push(article.id);
  const tarif = await tarifActif(article.id);
  assert.ok(tarif);
  assert.equal(tarif?.prixHT, 12.5);
  assert.equal(tarif?.uniteId, unitePieceId);
  assert.equal(tarif?.fournisseurId, fournisseurId);
  assert.equal(tarif?.actif, true);
});

// B — correspondance par référence exacte : continue son traitement automatique habituel, sans
// confirmation, même via ce nouveau mécanisme.
test("B — correspondance par référence exacte : mise à jour automatique du tarif, sans confirmation", async () => {
  const { articleId } = await creerArticleAvecTarif("IMPORT LISTING TEST Article Référence B", "REFB-001", 15);

  const apercu = await fetch(`${baseUrl}/api/articles/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      lignes: [{ designation: "Désignation totalement différente", reference: "REFB-001", prix: "18.00" }],
    }),
  });
  const corpsApercu = await apercu.json();
  assert.equal(corpsApercu.propositions[0].statut, "tarif_a_remplacer");
  assert.equal(corpsApercu.propositions[0].typeCorrespondance, "reference");
  assert.equal(corpsApercu.propositions[0].articleId, articleId);

  const tarifAvant = await tarifActif(articleId);

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      // Pas de confirmationArticleId : une correspondance par référence n'en a jamais besoin.
      lignes: [{ designation: "Désignation totalement différente", reference: "REFB-001", prix: "18.00" }],
    }),
  });
  const corps = await reponse.json();
  assert.equal(corps.misesAJour, 1);
  assert.equal(corps.enAttente, 0);

  const tarifApres = await tarifActif(articleId);
  assert.notEqual(tarifApres?.id, tarifAvant?.id, "un nouveau tarif doit avoir été ouvert");
  assert.equal(tarifApres?.prixHT, 18);
  const ancienTarif = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifAvant!.id } });
  assert.equal(ancienTarif.actif, false, "l'ancien tarif doit avoir été clôturé");
  assert.ok(ancienTarif.dateFin, "l'ancien tarif doit porter une date de fin");
});

// C — correspondance approximative en aperçu : jamais d'écriture, et jamais de création du
// fournisseur inconnu du listing (lecture seule).
test("C — correspondance approximative : proposée en aperçu, sans aucune écriture ni création de fournisseur", async () => {
  const { articleId, tarifId } = await creerArticleAvecTarif(
    "IMPORT LISTING TEST Creme Fraiche Epaisse",
    null,
    20
  );
  const fournisseurInconnu = "IMPORT LISTING TEST Fournisseur Jamais Créé";
  const avantFournisseurs = await prisma.fournisseur.count({ where: { nom: fournisseurInconnu } });
  assert.equal(avantFournisseurs, 0);

  const apercu = await fetch(`${baseUrl}/api/articles/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom: fournisseurInconnu,
      lignes: [{ designation: "IMPORT LISTING TEST Creme Fraiche Liquide", prix: "22.00" }],
    }),
  });
  assert.equal(apercu.status, 200);
  const corps = await apercu.json();
  assert.equal(corps.propositions.length, 1);
  const proposition = corps.propositions[0];
  assert.equal(proposition.statut, "tarif_a_remplacer");
  assert.equal(proposition.typeCorrespondance, "approximative");
  assert.equal(proposition.articleId, articleId);
  assert.ok(proposition.score >= 0.6 && proposition.score < 1);

  const apresFournisseurs = await prisma.fournisseur.count({ where: { nom: fournisseurInconnu } });
  assert.equal(apresFournisseurs, 0, "l'aperçu ne doit jamais créer de fournisseur");

  const tarifApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifId } });
  assert.equal(tarifApres.actif, true);
  assert.equal(tarifApres.prixHT, 20, "l'aperçu ne doit jamais modifier le tarif existant");
});

// D — correspondance approximative non confirmée : refus d'écriture, tarif existant inchangé.
test("D — correspondance approximative non confirmée : jamais écrite, comptée en enAttente", async () => {
  const { articleId, tarifId } = await creerArticleAvecTarif(
    "IMPORT LISTING TEST Yaourt Nature Bio",
    null,
    20
  );

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      // Aucune confirmationArticleId transmise.
      lignes: [{ designation: "IMPORT LISTING TEST Yaourt Nature Ferme", prix: "22.00" }],
    }),
  });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.misesAJour, 0);
  assert.equal(corps.crees, 0);
  assert.equal(corps.enAttente, 1);

  const tarifApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifId } });
  assert.equal(tarifApres.actif, true, "le tarif actif d'origine ne doit jamais être clôturé sans confirmation");
  assert.equal(tarifApres.prixHT, 20);
  const nombreTarifs = await prisma.tarifArticle.count({ where: { articleId } });
  assert.equal(nombreTarifs, 1, "aucun tarif supplémentaire ne doit avoir été créé");
});

// E — correspondance approximative confirmée explicitement : écriture autorisée.
test("E — correspondance approximative confirmée (articleId exact) : tarif remplacé", async () => {
  const { articleId, tarifId } = await creerArticleAvecTarif(
    "IMPORT LISTING TEST Chocolat Noir Patissier",
    null,
    20
  );

  const apercu = await fetch(`${baseUrl}/api/articles/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      lignes: [{ designation: "IMPORT LISTING TEST Chocolat Noir Dessert", prix: "22.00" }],
    }),
  });
  const propositionApercu = (await apercu.json()).propositions[0];
  assert.equal(propositionApercu.articleId, articleId);

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      lignes: [
        {
          designation: "IMPORT LISTING TEST Chocolat Noir Dessert",
          prix: "22.00",
          confirmationArticleId: propositionApercu.articleId,
        },
      ],
    }),
  });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.misesAJour, 1);
  assert.equal(corps.enAttente, 0);

  const ancienTarif = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifId } });
  assert.equal(ancienTarif.actif, false);
  assert.ok(ancienTarif.dateFin);

  const nouveauTarif = await tarifActif(articleId);
  assert.notEqual(nouveauTarif?.id, tarifId);
  assert.equal(nouveauTarif?.prixHT, 22);
});

// F — tarif inchangé : aucune clôture ni recréation inutile du tarif (même prix/unité/fournisseur).
test("F — désignation, prix, unité et fournisseur identiques : tarif inchangé, aucune écriture", async () => {
  const designation = "IMPORT LISTING TEST Statu Quo Article";
  const { articleId, tarifId } = await creerArticleAvecTarif(designation, null, 9.99);

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      lignes: [{ designation, prix: "9.99" }],
    }),
  });
  const corps = await reponse.json();
  assert.equal(corps.inchanges, 1);
  assert.equal(corps.misesAJour, 0);
  assert.equal(corps.crees, 0);

  const tarifApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifId } });
  assert.equal(tarifApres.id, tarifId, "même ligne TarifArticle, jamais recréée");
  assert.equal(tarifApres.actif, true);
  const nombreTarifs = await prisma.tarifArticle.count({ where: { articleId } });
  assert.equal(nombreTarifs, 1);
});

// G — plusieurs lignes dans un même import : référence auto, approximative confirmée,
// approximative refusée, et création, chacune traitée indépendamment et correctement.
test("G — lot de plusieurs lignes : chaque statut traité indépendamment", async () => {
  const refArticle = await creerArticleAvecTarif("IMPORT LISTING TEST Lot Référence", "REFG-001", 5);
  const approxArticle = await creerArticleAvecTarif("IMPORT LISTING TEST Sucre Blanc Cristal", null, 20);

  const apercu = await fetch(`${baseUrl}/api/articles/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      lignes: [
        { designation: "Peu importe", reference: "REFG-001", prix: "6.00" },
        { designation: "IMPORT LISTING TEST Sucre Blanc Poudre", prix: "23.00" },
        { designation: "IMPORT LISTING TEST Abricot Sec Vrac", prix: "3.00" },
      ],
    }),
  });
  const propositions = (await apercu.json()).propositions;
  assert.equal(propositions.length, 3);
  const propositionApprox = propositions[1];
  assert.equal(propositionApprox.typeCorrespondance, "approximative");

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      lignes: [
        { designation: "Peu importe", reference: "REFG-001", prix: "6.00" },
        {
          designation: "IMPORT LISTING TEST Sucre Blanc Poudre",
          prix: "23.00",
          confirmationArticleId: propositionApprox.articleId,
        },
        { designation: "IMPORT LISTING TEST Abricot Sec Vrac", prix: "3.00" },
      ],
    }),
  });
  const corps = await reponse.json();
  assert.equal(corps.misesAJour, 2, "référence + approximative confirmée");
  assert.equal(corps.crees, 1);
  assert.equal(corps.enAttente, 0);

  const tarifRef = await tarifActif(refArticle.articleId);
  assert.equal(tarifRef?.prixHT, 6);
  const tarifApprox = await tarifActif(approxArticle.articleId);
  assert.equal(tarifApprox?.prixHT, 23);
  const nouvelArticle = await prisma.article.findFirstOrThrow({
    where: { nom: "IMPORT LISTING TEST Abricot Sec Vrac" },
  });
  articleIds.push(nouvelArticle.id);
});

// H — confirmation désignant un autre article que celui réellement proposé : refusée.
test("H — confirmationArticleId ne correspond pas à la proposition réévaluée : refus", async () => {
  const { tarifId } = await creerArticleAvecTarif("IMPORT LISTING TEST Farine Ble T55", null, 20);
  const autreArticle = await creerArticleAvecTarif("IMPORT LISTING TEST Semoule Fine Paquet", null, 50);

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      lignes: [
        {
          designation: "IMPORT LISTING TEST Farine Ble T65",
          prix: "22.00",
          confirmationArticleId: autreArticle.articleId,
        },
      ],
    }),
  });
  const corps = await reponse.json();
  assert.equal(corps.misesAJour, 0);
  assert.equal(corps.enAttente, 1);

  const tarifApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifId } });
  assert.equal(tarifApres.actif, true, "l'article visé par la vraie correspondance ne doit pas être touché");
  const tarifAutre = await tarifActif(autreArticle.articleId);
  assert.equal(tarifAutre?.id, autreArticle.tarifId, "l'article confirmé à tort n'a lui non plus subi aucune écriture");
});

// I — proposition périmée entre l'aperçu et la validation : la confirmation transmise ne
// correspond plus à la correspondance réévaluée fraîchement (ici, l'article proposé a été
// désactivé entretemps) -> jamais un remplacement de tarif basé sur une confirmation obsolète.
test("I — proposition périmée (article désactivé après l'aperçu) : jamais un remplacement basé sur la confirmation obsolète", async () => {
  const { articleId, tarifId } = await creerArticleAvecTarif(
    "IMPORT LISTING TEST Huile Olive Vierge",
    null,
    20
  );

  const apercu = await fetch(`${baseUrl}/api/articles/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      lignes: [{ designation: "IMPORT LISTING TEST Huile Olive Extra", prix: "22.00" }],
    }),
  });
  const propositionApercu = (await apercu.json()).propositions[0];
  assert.equal(propositionApercu.articleId, articleId);

  // L'état change entre l'aperçu et la validation : l'article proposé est désactivé.
  await prisma.article.update({ where: { id: articleId }, data: { actif: false } });

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom,
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      lignes: [
        {
          designation: "IMPORT LISTING TEST Huile Olive Extra",
          prix: "22.00",
          confirmationArticleId: propositionApercu.articleId,
        },
      ],
    }),
  });
  const corps = await reponse.json();
  // L'article désactivé n'est plus un candidat : la ligne est réévaluée comme une création, la
  // confirmation obsolète (portant sur l'ancien articleId) ne s'applique à rien.
  assert.equal(corps.crees, 1);
  assert.equal(corps.misesAJour, 0);
  assert.equal(corps.enAttente, 0);

  const tarifApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifId } });
  assert.equal(tarifApres.actif, true, "le tarif de l'article désactivé ne doit jamais être clôturé via la confirmation périmée");
  assert.equal(tarifApres.prixHT, 20);

  const nouvelArticle = await prisma.article.findFirstOrThrow({
    where: { nom: "IMPORT LISTING TEST Huile Olive Extra" },
  });
  articleIds.push(nouvelArticle.id);
});
