import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Test d'intégration réel contre POST /api/articles/import (app Express réelle, vrai Postgres) —
// chantier « identité fournisseur + historique des imports de listings ». Objet : un import Excel
// ne doit jamais créer un nouveau Fournisseur pour un nom déjà existant (après trim+minuscule),
// jamais fusionner deux fournisseurs physiques réellement distincts partageant le même nom, et
// doit historiser chaque import via DocumentFournisseur/LigneDocumentFournisseur (modèle existant,
// réutilisé tel quel).

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
const articleIds: number[] = [];
const fournisseurIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function poster(lignes: object[], extra: Record<string, unknown> = {}) {
  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom: "IDENTITE TEST NouveauFournisseur",
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      lignes,
      ...extra,
    }),
  });
  const corps = await reponse.json();
  return { status: reponse.status, corps };
}

async function fournisseursNommes(nom: string) {
  return prisma.fournisseur.findMany({ where: { nom, societeId } });
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
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
});

after(async () => {
  try {
    const documents = await prisma.documentFournisseur.findMany({
      where: { fournisseur: { nom: { startsWith: "IDENTITE TEST" } } },
      select: { id: true },
    });
    await prisma.ligneDocumentFournisseur.deleteMany({ where: { documentId: { in: documents.map((d) => d.id) } } });
    await prisma.documentFournisseur.deleteMany({ where: { id: { in: documents.map((d) => d.id) } } });

    // Nettoyage par préfixe de nom, pas seulement articleIds : un run précédent interrompu avant
    // d'atteindre ce hook (crash, kill) laisse des articles "IDENTITE TEST ..." orphelins avec leur
    // propre TarifArticle encore attaché, hors de articleIds (vide dans ce run-ci) — les inclure ici
    // évite d'échouer sur la contrainte de clé étrangère en tentant de supprimer ces articles sans
    // d'abord supprimer leurs tarifs (même correctif que tests/unit/articlesImportListing.test.ts).
    const articlesASupprimer = await prisma.article.findMany({
      where: { OR: [{ id: { in: articleIds } }, { nom: { startsWith: "IDENTITE TEST" } }] },
      select: { id: true },
    });
    const idsASupprimer = articlesASupprimer.map((a) => a.id);
    await prisma.tarifArticle.deleteMany({ where: { articleId: { in: idsASupprimer } } });
    await prisma.article.deleteMany({ where: { id: { in: idsASupprimer } } });
    await prisma.fournisseur.deleteMany({ where: { nom: { startsWith: "IDENTITE TEST" } } });
  } finally {
    // Toujours fermer le serveur HTTP, même si le nettoyage ci-dessus échoue : un handle serveur
    // resté ouvert empêche ce processus de fichier de jamais se terminer, ce qui bloque
    // indéfiniment tous les fichiers suivants sous --test-concurrency=1 (même raison que
    // tests/unit/articlesImportListing.test.ts).
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("A. premier import d'un fournisseur inexistant : 1 fournisseur, 1 document, 1 ligne, 1 tarif", async () => {
  const { status, corps } = await poster(
    [{ designation: "IDENTITE TEST Poulet", prix: "6.20" }],
    { nomFichierOriginal: "listing-test.xlsx", typeMime: "text/csv", tailleOctets: 1234 }
  );
  assert.equal(status, 200);
  assert.equal(corps.crees, 1);

  const fournisseurs = await fournisseursNommes("IDENTITE TEST NouveauFournisseur");
  assert.equal(fournisseurs.length, 1, "un seul fournisseur doit exister pour ce nom");
  fournisseurIds.push(fournisseurs[0].id);

  const article = await prisma.article.findFirst({ where: { nom: "IDENTITE TEST Poulet" } });
  assert.ok(article);
  articleIds.push(article!.id);

  const documents = await prisma.documentFournisseur.findMany({ where: { fournisseurId: fournisseurs[0].id } });
  assert.equal(documents.length, 1, "un document LISTING doit tracer cet import");
  assert.equal(documents[0].type, "LISTING");
  assert.equal(documents[0].nomFichierOriginal, "listing-test.xlsx");
  assert.equal(documents[0].typeMime, "text/csv");
  assert.equal(documents[0].tailleOctets, 1234);

  const lignesDocument = await prisma.ligneDocumentFournisseur.findMany({ where: { documentId: documents[0].id } });
  assert.equal(lignesDocument.length, 1);
  assert.equal(lignesDocument[0].designationLue, "IDENTITE TEST Poulet");
  assert.equal(lignesDocument[0].decision, "VALIDEE");
  assert.equal(lignesDocument[0].articleRetenuId, article!.id);
  assert.ok(lignesDocument[0].tarifCreeId, "la ligne doit pointer vers le tarif qu'elle a créé (J)");

  const tarif = await prisma.tarifArticle.findUnique({ where: { id: lignesDocument[0].tarifCreeId! } });
  assert.equal(tarif?.articleId, article!.id);
  assert.equal(tarif?.fournisseurId, fournisseurs[0].id);
});

test("B. deuxième import du même fournisseur (nom exact) : réutilisation, 2 documents", async () => {
  const { status, corps } = await poster([{ designation: "IDENTITE TEST Fromage", prix: "3.00" }]);
  assert.equal(status, 200);
  assert.equal(corps.crees, 1);

  const fournisseurs = await fournisseursNommes("IDENTITE TEST NouveauFournisseur");
  assert.equal(fournisseurs.length, 1, "toujours un seul fournisseur, pas de doublon");

  const article = await prisma.article.findFirst({ where: { nom: "IDENTITE TEST Fromage" } });
  articleIds.push(article!.id);

  const documents = await prisma.documentFournisseur.findMany({ where: { fournisseurId: fournisseurs[0].id } });
  assert.equal(documents.length, 2, "un deuxième import doit ajouter un deuxième document, jamais fusionné avec le premier");
});

test("C. casse différente ('identite test nouveaufournisseur') : réutilisation, pas de doublon", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom: "identite test nouveaufournisseur",
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      lignes: [{ designation: "IDENTITE TEST Lait", prix: "1.10" }],
    }),
  });
  const corps = await reponse.json();
  assert.equal(reponse.status, 200);
  assert.equal(corps.crees, 1);

  const fournisseurs = await fournisseursNommes("IDENTITE TEST NouveauFournisseur");
  assert.equal(fournisseurs.length, 1, "la casse différente ne doit jamais créer un second fournisseur");

  const article = await prisma.article.findFirst({ where: { nom: "IDENTITE TEST Lait" } });
  articleIds.push(article!.id);
  const tarif = await prisma.tarifArticle.findFirst({ where: { articleId: article!.id } });
  assert.equal(tarif?.fournisseurId, fournisseurs[0].id, "le tarif doit être rattaché au fournisseur existant, pas à un nouveau");
});

test("D. espaces externes différents ('  IDENTITE TEST NouveauFournisseur  ') : réutilisation", async () => {
  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom: "  IDENTITE TEST NouveauFournisseur  ",
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      lignes: [{ designation: "IDENTITE TEST Beurre", prix: "2.50" }],
    }),
  });
  const corps = await reponse.json();
  assert.equal(reponse.status, 200);
  assert.equal(corps.crees, 1);

  const fournisseurs = await fournisseursNommes("IDENTITE TEST NouveauFournisseur");
  assert.equal(fournisseurs.length, 1, "les espaces externes ne doivent jamais créer un second fournisseur");

  const article = await prisma.article.findFirst({ where: { nom: "IDENTITE TEST Beurre" } });
  articleIds.push(article!.id);
});

test("E. réimport identique (même désignation, même prix) : idempotent, aucun nouveau tarif", async () => {
  const avant = await prisma.tarifArticle.count({
    where: { article: { nom: "IDENTITE TEST Poulet" } },
  });

  const { status, corps } = await poster([{ designation: "IDENTITE TEST Poulet", prix: "6.20" }]);
  assert.equal(status, 200);
  assert.equal(corps.inchanges, 1, "un réimport identique doit être détecté inchangé, jamais recréé");
  assert.equal(corps.crees, 0);
  assert.equal(corps.misesAJour, 0);

  const apres = await prisma.tarifArticle.count({
    where: { article: { nom: "IDENTITE TEST Poulet" } },
  });
  assert.equal(apres, avant, "aucun tarif supplémentaire ne doit être créé par un réimport identique");
});

test("F. nouveau prix sur le même article/fournisseur : historique conservé, ancien tarif clôturé (pas supprimé)", async () => {
  const article = await prisma.article.findFirst({ where: { nom: "IDENTITE TEST Poulet" } });
  const ancienTarifActif = await prisma.tarifArticle.findFirst({
    where: { articleId: article!.id, actif: true },
  });
  assert.ok(ancienTarifActif);

  // Correspondance par désignation (aucune référence des deux côtés) = "approximative" : ne peut
  // jamais être écrite sans confirmationArticleId explicite (voir PR #79, importListing.ts) —
  // jamais contourné ici, comportement intentionnel et préexistant.
  const { status, corps } = await poster([
    { designation: "IDENTITE TEST Poulet", prix: "5.95", confirmationArticleId: article!.id },
  ]);
  assert.equal(status, 200);
  assert.equal(corps.misesAJour, 1);

  const ancienRelu = await prisma.tarifArticle.findUnique({ where: { id: ancienTarifActif!.id } });
  assert.equal(ancienRelu?.actif, false, "l'ancien tarif doit être clôturé, jamais supprimé");
  assert.ok(ancienRelu?.dateFin, "l'ancien tarif doit porter une dateFin");

  const nouveauTarifActif = await prisma.tarifArticle.findFirst({
    where: { articleId: article!.id, actif: true },
  });
  assert.equal(nouveauTarifActif?.prixHT, 5.95);

  const tousLesTarifs = await prisma.tarifArticle.count({ where: { articleId: article!.id } });
  assert.equal(tousLesTarifs, 2, "l'ancien tarif doit rester interrogeable, jamais perdu");
});

test("G. deux vrais fournisseurs physiques homonymes (téléphones différents) : ambiguïté explicite, aucune écriture, aucun 3e fournisseur", async () => {
  const homonymeA = await prisma.fournisseur.create({
    data: { nom: "IDENTITE TEST Homonyme", telephone: "0611111111", societeId },
  });
  const homonymeB = await prisma.fournisseur.create({
    data: { nom: "IDENTITE TEST Homonyme", telephone: "0622222222", societeId },
  });

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      societeId,
      fournisseurNom: "IDENTITE TEST Homonyme",
      categorieId,
      tvaId,
      type: "MATIERE_PREMIERE",
      lignes: [{ designation: "IDENTITE TEST ArticleHomonyme", prix: "2.00" }],
    }),
  });
  const corps = await reponse.json();

  assert.equal(reponse.status, 409, "une ambiguïté fournisseur doit être refusée explicitement (409), jamais un choix arbitraire");
  assert.match(corps.error, /[Aa]mbigu|[Pp]lusieurs fournisseurs/);
  assert.deepEqual(new Set(corps.fournisseurIds), new Set([homonymeA.id, homonymeB.id]));

  const fournisseurs = await fournisseursNommes("IDENTITE TEST Homonyme");
  assert.equal(fournisseurs.length, 2, "aucun 3e fournisseur ne doit avoir été créé");

  const articleCree = await prisma.article.findFirst({ where: { nom: "IDENTITE TEST ArticleHomonyme" } });
  assert.equal(articleCree, null, "aucun article ne doit avoir été créé tant que l'ambiguïté n'est pas résolue");
});

test("H. ambiguïté propre à une ligne (colonne Fournisseur) : cette ligne est ignorée, les autres lignes valides du même import sont traitées", async () => {
  await prisma.fournisseur.create({ data: { nom: "IDENTITE TEST HomonymeLigne", telephone: "0633333333", societeId } });
  await prisma.fournisseur.create({ data: { nom: "IDENTITE TEST HomonymeLigne", telephone: "0644444444", societeId } });

  const { status, corps } = await poster([
    { designation: "IDENTITE TEST ArticleOK", prix: "4.00" },
    { designation: "IDENTITE TEST ArticleAmbigu", prix: "9.00", fournisseur: "IDENTITE TEST HomonymeLigne" },
  ]);

  assert.equal(status, 200, "l'ambiguïté d'une seule ligne ne doit jamais bloquer tout l'import");
  assert.equal(corps.crees, 1, "seule la ligne non ambiguë doit être écrite");
  assert.ok(corps.erreurs.some((e: string) => e.includes("ArticleAmbigu")));

  const articleOk = await prisma.article.findFirst({ where: { nom: "IDENTITE TEST ArticleOK" } });
  assert.ok(articleOk, "la ligne valide doit avoir été importée normalement");
  articleIds.push(articleOk!.id);

  const articleAmbigu = await prisma.article.findFirst({ where: { nom: "IDENTITE TEST ArticleAmbigu" } });
  assert.equal(articleAmbigu, null, "la ligne ambiguë ne doit jamais être écrite");

  const fournisseursHomonymeLigne = await fournisseursNommes("IDENTITE TEST HomonymeLigne");
  assert.equal(fournisseursHomonymeLigne.length, 2, "aucun 3e fournisseur créé par la ligne ambiguë");
});

test("L. deux imports simultanés avec un nom de fournisseur inédit : documente le comportement observé (concurrence non corrigée dans ce chantier)", async () => {
  const nomInedit = "IDENTITE TEST Concurrence";

  const [reponseA, reponseB] = await Promise.all([
    fetch(`${baseUrl}/api/articles/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        societeId,
        fournisseurNom: nomInedit,
        categorieId,
        tvaId,
        type: "MATIERE_PREMIERE",
        lignes: [{ designation: "IDENTITE TEST ArticleConcurrentA", prix: "1.00" }],
      }),
    }),
    fetch(`${baseUrl}/api/articles/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        societeId,
        fournisseurNom: nomInedit,
        categorieId,
        tvaId,
        type: "MATIERE_PREMIERE",
        lignes: [{ designation: "IDENTITE TEST ArticleConcurrentB", prix: "1.00" }],
      }),
    }),
  ]);

  assert.equal(reponseA.status, 200, "aucune des deux requêtes ne doit planter (500)");
  assert.equal(reponseB.status, 200);

  const fournisseurs = await fournisseursNommes(nomInedit);
  // Documente le résultat réel plutôt que d'imposer un chiffre : la race décrite en Phase 9 n'est
  // PAS corrigée dans ce chantier (aucune contrainte unique ajoutée, conformément au mandat) — 1
  // fournisseur signifie qu'elle ne s'est pas manifestée sur cette exécution, 2 qu'elle s'est
  // manifestée. Un nombre supérieur à 2 serait en revanche une régression réelle.
  assert.ok(
    fournisseurs.length === 1 || fournisseurs.length === 2,
    `résultat observé inattendu : ${fournisseurs.length} fournisseurs pour "${nomInedit}"`
  );
  console.log(
    `[concurrence — non corrigée, documentée] ${fournisseurs.length} fournisseur(s) créé(s) pour un import simultané du même nom inédit.`
  );

  const articleA = await prisma.article.findFirst({ where: { nom: "IDENTITE TEST ArticleConcurrentA" } });
  const articleB = await prisma.article.findFirst({ where: { nom: "IDENTITE TEST ArticleConcurrentB" } });
  if (articleA) articleIds.push(articleA.id);
  if (articleB) articleIds.push(articleB.id);
  assert.ok(articleA && articleB, "les deux imports doivent malgré tout réussir à écrire leur article");
});
