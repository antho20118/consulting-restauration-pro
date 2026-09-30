import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";
import { normaliserCodeProduitFournisseur } from "../../server/utils/importListing.js";

// Test d'intégration réel (app Express réelle, vrai Postgres) — correction « identification des
// articles lors des imports de listings fournisseurs ». Couvre la règle d'identité définitive :
// Cas A (code connu, désignation proche ou identique -> réutilisation, jamais de duplication),
// Cas B (code connu, désignation modérément différente -> réutilisation quand même, alerte
// seulement en-dessous du seuil), Cas C (code absent sur un import lancé depuis la fiche
// fournisseur -> ligne refusée, jamais de création "silencieuse" qui ferait grossir la base à
// chaque réimport), et la normalisation des caractères invisibles (espace insécable, caractères de
// largeur nulle) qui peuvent différer d'un export à l'autre sans changer le code produit réel. Le
// flux historique (import générique sans fournisseurId de contexte) reste volontairement non
// concerné par le Cas C — voir test 8.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let fournisseurAutreId: number;

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function poster(corps: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corps),
  });
  return { status: reponse.status, corps: await reponse.json() };
}

async function apercu(corps: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/articles/import/apercu`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(corps),
  });
  return { status: reponse.status, corps: await reponse.json() };
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

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "IDENT TEST FOURNISSEUR A", societeId } });
  fournisseurId = fournisseur.id;
  const fournisseurAutre = await prisma.fournisseur.create({ data: { nom: "IDENT TEST FOURNISSEUR B", societeId } });
  fournisseurAutreId = fournisseurAutre.id;
});

after(async () => {
  const documents = await prisma.documentFournisseur.findMany({
    where: { fournisseur: { nom: { startsWith: "IDENT TEST" } } },
    select: { id: true },
  });
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { documentId: { in: documents.map((d) => d.id) } } });
  await prisma.documentFournisseur.deleteMany({ where: { id: { in: documents.map((d) => d.id) } } });
  await prisma.produitFournisseur.deleteMany({ where: { fournisseurId: { in: [fournisseurId, fournisseurAutreId] } } });
  await prisma.tarifArticle.deleteMany({
    where: {
      OR: [
        { fournisseurId: { in: [fournisseurId, fournisseurAutreId] } },
        { article: { nom: { startsWith: "IDENT TEST" } } },
      ],
    },
  });
  await prisma.article.deleteMany({ where: { nom: { startsWith: "IDENT TEST" } } });
  await prisma.fournisseur.deleteMany({ where: { nom: { startsWith: "IDENT TEST" } } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("1. Cas A — réimport strictement identique (même code, même désignation, même prix) : aucune création, tarif inchangé", async () => {
  const designation = "IDENT TEST Emmental Rape 1KG";
  const code = "CAS-A-001";

  const premier = await poster({
    societeId, fournisseurId, categorieId, tvaId, type: "MATIERE_PREMIERE",
    lignes: [{ designation, prix: "6.00", codeProduitFournisseur: code }],
  });
  assert.equal(premier.status, 200);
  assert.equal(premier.corps.crees, 1);

  const articlesApresPremier = await prisma.article.count({ where: { nom: designation } });
  assert.equal(articlesApresPremier, 1);

  const second = await poster({
    societeId, fournisseurId, categorieId, tvaId, type: "MATIERE_PREMIERE",
    lignes: [{ designation, prix: "6.00", codeProduitFournisseur: code }],
  });
  assert.equal(second.status, 200);
  assert.equal(second.corps.crees, 0, "aucune nouvelle création au réimport identique");
  assert.equal(second.corps.misesAJour, 0);
  assert.equal(second.corps.inchanges, 1);

  const articlesApresSecond = await prisma.article.count({ where: { nom: designation } });
  assert.equal(articlesApresSecond, 1, "le nombre d'articles ne doit jamais croître à un réimport sans changement");

  const produitsFournisseur = await prisma.produitFournisseur.count({
    where: { fournisseurId, codeProduitFournisseur: code },
  });
  assert.equal(produitsFournisseur, 1);

  const tarifs = await prisma.tarifArticle.findMany({
    where: { article: { nom: designation }, fournisseurId },
  });
  assert.equal(tarifs.length, 1, "aucun nouveau tarif créé quand le prix ne change pas");
  assert.equal(tarifs[0].actif, true);
});

test("2. Cas A — réimport même code avec changement de prix : même article, tarif historisé, jamais de duplication", async () => {
  // Désignation sans marqueur de poids/volume reconnu (voir extraireQuantiteDesignation) : ce test
  // isole le rapprochement par code produit, pas la logique de prix au kg déjà couverte ailleurs.
  const designation = "IDENT TEST Farine T55 Premium";
  const code = "CAS-A-002";

  const premier = await poster({
    societeId, fournisseurId, categorieId, tvaId, type: "MATIERE_PREMIERE",
    lignes: [{ designation, prix: "18.00", codeProduitFournisseur: code }],
  });
  assert.equal(premier.status, 200);
  assert.equal(premier.corps.crees, 1);
  const article = await prisma.article.findFirstOrThrow({ where: { nom: designation } });

  const second = await poster({
    societeId, fournisseurId, categorieId, tvaId, type: "MATIERE_PREMIERE",
    lignes: [{ designation, prix: "19.50", codeProduitFournisseur: code }],
  });
  assert.equal(second.status, 200);
  assert.equal(second.corps.crees, 0, "un changement de prix ne doit jamais créer un nouvel article");
  assert.equal(second.corps.misesAJour, 1);

  const articlesApres = await prisma.article.count({ where: { nom: designation } });
  assert.equal(articlesApres, 1);

  const produitsFournisseur = await prisma.produitFournisseur.count({
    where: { fournisseurId, codeProduitFournisseur: code },
  });
  assert.equal(produitsFournisseur, 1, "toujours une seule identité produit fournisseur pour ce code");

  const tarifs = await prisma.tarifArticle.findMany({
    where: { articleId: article.id, fournisseurId },
    orderBy: { id: "asc" },
  });
  assert.equal(tarifs.length, 2, "l'ancien tarif est historisé (jamais supprimé), un nouveau tarif actif est créé");
  assert.equal(tarifs[0].actif, false);
  assert.equal(tarifs[1].actif, true);
  assert.equal(tarifs[1].prixHT, 19.5);
});

test("3. Cas B — même code, désignation modérément différente : réutilisation du même article, pas de doublon", async () => {
  const code = "CAS-B-003";
  // Sans marqueur de poids/volume reconnu (voir extraireQuantiteDesignation), pour isoler la
  // correspondance par code produit de la logique de prix au kg.
  const designationInitiale = "IDENT TEST Jambon Blanc Superieur Premium";
  // Désignation volontairement modifiée mais lexicalement proche (score Jaccard >= 0.6) : simule un
  // libellé légèrement mis à jour par le fournisseur d'un export à l'autre.
  const designationMiseAJour = "IDENT TEST Jambon Blanc Superieur Extra";

  const premier = await poster({
    societeId, fournisseurId, categorieId, tvaId, type: "MATIERE_PREMIERE",
    lignes: [{ designation: designationInitiale, prix: "20.00", codeProduitFournisseur: code }],
  });
  assert.equal(premier.status, 200);
  assert.equal(premier.corps.crees, 1);
  const article = await prisma.article.findFirstOrThrow({ where: { nom: designationInitiale } });

  const second = await poster({
    societeId, fournisseurId, categorieId, tvaId, type: "MATIERE_PREMIERE",
    lignes: [{ designation: designationMiseAJour, prix: "21.00", codeProduitFournisseur: code }],
  });
  assert.equal(second.status, 200);
  assert.equal(second.corps.crees, 0, "le Cas B réutilise l'article existant, jamais de nouvelle création");
  assert.equal(second.corps.misesAJour, 1);

  const articlesTotal = await prisma.article.count({
    where: { nom: { startsWith: "IDENT TEST Jambon Blanc Superieur" } },
  });
  assert.equal(articlesTotal, 1);

  const tarifActif = await prisma.tarifArticle.findFirstOrThrow({
    where: { articleId: article.id, fournisseurId, actif: true },
  });
  assert.equal(tarifActif.prixHT, 21);
});

test("4. Cas C — import contextuel (fiche fournisseur) sans code produit fournisseur : ligne refusée, aucune création", async () => {
  const designation = "IDENT TEST Sans Code Ne Doit Pas Exister";

  const { status, corps } = await poster({
    societeId, fournisseurId, categorieId, tvaId, type: "MATIERE_PREMIERE",
    lignes: [{ designation, prix: "3.00" }],
  });
  assert.equal(status, 200);
  assert.equal(corps.crees, 0);
  assert.equal(corps.misesAJour, 0);
  assert.ok(
    corps.erreurs.some((e: string) => e.includes("code produit fournisseur manquant")),
    `attendu un message d'erreur explicite, reçu : ${JSON.stringify(corps.erreurs)}`
  );

  const article = await prisma.article.findFirst({ where: { nom: designation } });
  assert.equal(article, null, "aucun article ne doit être créé sans code produit fournisseur en import contextuel");
});

test("5. Cas C — aperçu (POST /import/apercu) contextuel sans code produit fournisseur : statut code_produit_manquant", async () => {
  const designation = "IDENT TEST Apercu Sans Code";

  const { status, corps } = await apercu({
    societeId, fournisseurId,
    lignes: [{ designation, prix: "3.00" }],
  });
  assert.equal(status, 200);
  assert.equal(corps.propositions.length, 1);
  assert.equal(corps.propositions[0].statut, "code_produit_manquant");
  assert.equal(corps.propositions[0].designation, designation);
});

test("6. normalisation des caractères invisibles : espace insécable et caractère de largeur nulle n'introduisent jamais de doublon", async () => {
  // Unité de la fonction elle-même, indépendamment de toute écriture en base.
  assert.equal(normaliserCodeProduitFournisseur("NORM 001"), "NORM 001");
  assert.equal(normaliserCodeProduitFournisseur("ZW​002"), "ZW002");
  assert.equal(normaliserCodeProduitFournisseur("  BORD-003  "), "BORD-003");
  // Ne touche NI à la casse NI aux zéros initiaux (aucune preuve ne justifie de les considérer
  // équivalents) : "001234" reste "001234", "abc" reste "abc" (pas de mise en majuscules).
  assert.equal(normaliserCodeProduitFournisseur("001234"), "001234");
  assert.equal(normaliserCodeProduitFournisseur("abcDEF"), "abcDEF");

  const designation = "IDENT TEST Beurre Doux 250G";
  const premier = await poster({
    societeId, fournisseurId, categorieId, tvaId, type: "MATIERE_PREMIERE",
    // Code contenant un espace insécable (comportement fréquent d'un export Excel).
    lignes: [{ designation, prix: "2.50", codeProduitFournisseur: "NORM 001" }],
  });
  assert.equal(premier.status, 200);
  assert.equal(premier.corps.crees, 1);

  const second = await poster({
    societeId, fournisseurId, categorieId, tvaId, type: "MATIERE_PREMIERE",
    // Même code, mais avec un espace normal cette fois (variante byte-différente du même export) :
    // doit être reconnu comme le MÊME produit, jamais un nouveau.
    lignes: [{ designation, prix: "2.50", codeProduitFournisseur: "NORM 001" }],
  });
  assert.equal(second.status, 200);
  assert.equal(second.corps.crees, 0, "une variante d'espace insécable ne doit jamais créer un doublon");
  assert.equal(second.corps.inchanges, 1);

  const articles = await prisma.article.count({ where: { nom: designation } });
  assert.equal(articles, 1);
  const produitsFournisseur = await prisma.produitFournisseur.count({
    where: { fournisseurId, codeProduitFournisseur: "NORM 001" },
  });
  assert.equal(produitsFournisseur, 1, "le code est stocké déjà normalisé, une seule ligne ProduitFournisseur");
});

test("7. lecture Excel réelle (xlsx) : une colonne Code au format Texte préserve les zéros initiaux, au format Nombre elle les perd", async () => {
  const { lireFichierImport } = await import("../../src/common/importExcel.js");
  const XLSX = await import("xlsx");

  const classeurTexte = XLSX.utils.book_new();
  const feuilleTexte = XLSX.utils.aoa_to_sheet([["designation", "codeProduitFournisseur", "prix"]]);
  XLSX.utils.sheet_add_aoa(feuilleTexte, [["Article A", "001234", "5.00"]], { origin: -1 });
  // Force le type "s" (string) sur la cellule du code, comme le ferait Excel pour une colonne
  // explicitement mise au format Texte.
  feuilleTexte["B2"] = { t: "s", v: "001234" };
  XLSX.utils.book_append_sheet(classeurTexte, feuilleTexte, "Feuille1");
  const bufferTexte = XLSX.write(classeurTexte, { type: "buffer", bookType: "xlsx" });
  const fichierTexte = new File([bufferTexte], "listing-texte.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const resultatTexte = await lireFichierImport(fichierTexte);
  const indexCodeTexte = resultatTexte.entetes.indexOf("codeProduitFournisseur");
  assert.equal(resultatTexte.lignes[0][indexCodeTexte], "001234", "une cellule au format Texte préserve les zéros initiaux");

  const classeurNombre = XLSX.utils.book_new();
  const feuilleNombre = XLSX.utils.aoa_to_sheet([["designation", "codeProduitFournisseur", "prix"]]);
  // Cellule numérique (type "n") : c'est exactement ce que produit Excel quand la colonne est au
  // format Nombre — les zéros initiaux sont déjà perdus au moment où le fichier source est
  // enregistré, avant même que ce code ne lise quoi que ce soit (voir commentaire de
  // normaliserCodeProduitFournisseur : ce n'est pas corrigible côté lecture).
  feuilleNombre["B2"] = { t: "n", v: 1234 };
  XLSX.utils.sheet_add_aoa(feuilleNombre, [["Article B", undefined, "5.00"]], { origin: "A2" });
  XLSX.utils.book_append_sheet(classeurNombre, feuilleNombre, "Feuille1");
  const bufferNombre = XLSX.write(classeurNombre, { type: "buffer", bookType: "xlsx" });
  const fichierNombre = new File([bufferNombre], "listing-nombre.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const resultatNombre = await lireFichierImport(fichierNombre);
  const indexCodeNombre = resultatNombre.entetes.indexOf("codeProduitFournisseur");
  // sheet_to_json (mode raw, celui utilisé par lireFichierImport) renvoie le type natif de la
  // cellule : un nombre JS pour une cellule au format Nombre, jamais une chaîne "001234" — les
  // zéros initiaux sont déjà perdus au moment où Excel a stocké la cellule comme un nombre, avant
  // même que ce code ne s'exécute. La conversion en chaîne n'intervient que plus tard, côté
  // ImportListingModal.construireLignes (String(...).trim()), jamais ici.
  assert.equal(
    resultatNombre.lignes[0][indexCodeNombre],
    1234,
    "une cellule au format Nombre a irrémédiablement perdu les zéros initiaux, avant toute lecture applicative"
  );
  assert.equal(typeof resultatNombre.lignes[0][indexCodeNombre], "number");
});

test("8. flux historique (sans fournisseurId de contexte) : continue de fonctionner sans code produit fournisseur", async () => {
  const designation = "IDENT TEST Flux Historique Sans Code";

  const { status, corps } = await poster({
    societeId, fournisseurNom: "IDENT TEST FOURNISSEUR A", categorieId, tvaId, type: "MATIERE_PREMIERE",
    lignes: [{ designation, prix: "4.00" }],
  });
  assert.equal(status, 200);
  assert.equal(corps.crees, 1, "le flux générique historique (sans fournisseurId de contexte) n'est jamais concerné par le Cas C");
  assert.equal(corps.erreurs.length, 0);

  const article = await prisma.article.findFirstOrThrow({ where: { nom: designation } });
  assert.ok(article.id > 0);
});
