import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";
import { genererCodeFournisseur } from "../../server/routes/fournisseurs.js";

// Test d'intégration réel (app Express réelle, vrai Postgres) — chantier « identité fournisseur +
// produit fournisseur + historique des tarifs ». Couvre : génération atomique de codeFournisseur
// (y compris sous création concurrente réelle), résolution par code (niveau 1-3), ProduitFournisseur
// (cas 1-4 du cadrage), et surtout le test CRITIQUE reproduisant exactement le scénario
// CAPEMBAL/SUPER U : deux fournisseurs distincts, même article, aucun écrasement croisé de tarif.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let societeIdAutre: number;
let categorieId: number;
let tvaId: number;
const articleIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function creerFournisseur(nom: string) {
  const reponse = await fetch(`${baseUrl}/api/fournisseurs`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom }),
  });
  const corps = await reponse.json();
  return { status: reponse.status, corps };
}

async function importer(payload: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ societeId, categorieId, tvaId, type: "MATIERE_PREMIERE", ...payload }),
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

  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;

  // Unités/conditionnement de référence — jamais inventées : mêmes valeurs exactes que
  // prisma/seed.ts, lookup-or-create (peuvent déjà exister). POST /articles/import échoue sans
  // elles ("Aucune unité disponible") : nécessaires uniquement parce que l'environnement de cette
  // session a perdu ces données de référence (incident signalé séparément), pas une donnée propre
  // à ce chantier.
  const unitesRequises: { nom: string; symbole: string; type: string; facteurBase: number }[] = [
    { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 },
    { nom: "Litre", symbole: "L", type: "volume", facteurBase: 1000 },
    { nom: "Pièce", symbole: "pièce", type: "unite", facteurBase: 1 },
  ];
  for (const u of unitesRequises) {
    const existante = await prisma.unite.findFirst({ where: { symbole: u.symbole } });
    if (!existante) await prisma.unite.create({ data: u });
  }
  const conditionnementExistant = await prisma.conditionnement.findFirst();
  if (!conditionnementExistant) await prisma.conditionnement.create({ data: { nom: "Carton" } });

  const societeAutre = await prisma.societe.create({ data: { nom: "PFI TEST Société B" } });
  societeIdAutre = societeAutre.id;
});

after(async () => {
  try {
    const fournisseursTest = await prisma.fournisseur.findMany({
      where: { nom: { startsWith: "PFI TEST" } },
      select: { id: true },
    });
    const fournisseurIds = fournisseursTest.map((f) => f.id);

    const documents = await prisma.documentFournisseur.findMany({
      where: { fournisseurId: { in: fournisseurIds } },
      select: { id: true },
    });
    await prisma.ligneDocumentFournisseur.deleteMany({ where: { documentId: { in: documents.map((d) => d.id) } } });
    await prisma.documentFournisseur.deleteMany({ where: { id: { in: documents.map((d) => d.id) } } });

    // Nettoyage par préfixe de nom, pas seulement articleIds : un run précédent interrompu avant
    // d'atteindre ce hook (crash, kill) laisse des articles "PFI TEST ..." orphelins avec leur
    // propre TarifArticle encore attaché, hors de articleIds (vide dans ce run-ci) — les inclure
    // dans la même requête évite d'échouer sur la contrainte de clé étrangère en tentant de
    // supprimer ces articles sans d'abord supprimer leurs tarifs (même correctif que
    // tests/unit/articlesImportListing.test.ts et identiteFournisseurImportListing.test.ts).
    const articlesASupprimer = await prisma.article.findMany({
      where: { OR: [{ id: { in: articleIds } }, { nom: { startsWith: "PFI TEST" } }] },
      select: { id: true },
    });
    const idsASupprimer = articlesASupprimer.map((a) => a.id);
    await prisma.tarifArticle.deleteMany({
      where: { OR: [{ fournisseurId: { in: fournisseurIds } }, { articleId: { in: idsASupprimer } }] },
    });
    await prisma.produitFournisseur.deleteMany({ where: { fournisseurId: { in: fournisseurIds } } });
    await prisma.article.deleteMany({ where: { id: { in: idsASupprimer } } });
    await prisma.fournisseur.deleteMany({ where: { id: { in: fournisseurIds } } });
    await prisma.societeCompteur.deleteMany({ where: { societeId: societeIdAutre } });
    await prisma.societe.deleteMany({ where: { id: societeIdAutre } });
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

test("A1 — création d'un fournisseur génère automatiquement un codeFournisseur au format FOU-XXXX", async () => {
  const { status, corps } = await creerFournisseur("PFI TEST Fournisseur A1");
  assert.equal(status, 201);
  assert.match(corps.codeFournisseur, /^FOU-\d{4,}$/);
});

test("A2 — deux créations successives dans la même société reçoivent des codes strictement croissants", async () => {
  const r1 = await creerFournisseur("PFI TEST Fournisseur A2a");
  const r2 = await creerFournisseur("PFI TEST Fournisseur A2b");
  const n1 = Number(r1.corps.codeFournisseur.split("-")[1]);
  const n2 = Number(r2.corps.codeFournisseur.split("-")[1]);
  assert.ok(n2 > n1, `attendu n2 (${n2}) > n1 (${n1})`);
});

// Depuis le chantier isolation société : POST /fournisseurs ignore désormais tout societeId transmis
// par le client (toujours dérivé du compte connecté) — impossible de créer, via l'API, un
// fournisseur dans une société arbitraire choisie dans le corps de la requête (précisément ce que
// ce test vérifiait auparavant sans le vouloir). Le comportement du compteur par société
// (genererCodeFournisseur), lui, reste inchangé : vérifié ici directement au niveau utilitaire,
// dans une vraie transaction Prisma, plutôt qu'au travers d'une route qui ne le permet plus.
test("A3 — le compteur est indépendant par société (le même numéro peut apparaître dans deux sociétés)", async () => {
  const code = await prisma.$transaction((tx) => genererCodeFournisseur(tx, societeIdAutre));
  assert.match(code, /^FOU-0*1$/);
});

test("A4 — créations concurrentes réelles : tous les codes générés sont distincts (jamais de doublon)", async () => {
  const N = 8;
  const resultats = await Promise.all(
    Array.from({ length: N }, (_, i) => creerFournisseur(`PFI TEST Concurrence ${i}`))
  );
  for (const r of resultats) assert.equal(r.status, 201, JSON.stringify(r.corps));
  const codes = resultats.map((r) => r.corps.codeFournisseur);
  assert.equal(new Set(codes).size, N, `codes obtenus : ${codes.join(", ")}`);
});

test("A5/A6 — soft-delete conserve id/code/historique ; réactivation explicite restaure actif sans rien changer d'autre", async () => {
  const { corps: fournisseur } = await creerFournisseur("PFI TEST Fournisseur Reactivation");
  const codeInitial = fournisseur.codeFournisseur;

  const suppr = await fetch(`${baseUrl}/api/fournisseurs/${fournisseur.id}`, { method: "DELETE", headers: authHeaders() });
  assert.equal(suppr.status, 204);

  const apresDelete = await prisma.fournisseur.findUnique({ where: { id: fournisseur.id } });
  assert.equal(apresDelete?.actif, false);
  assert.equal(apresDelete?.codeFournisseur, codeInitial);
  assert.equal(apresDelete?.nom, "PFI TEST Fournisseur Reactivation");

  const reactivation = await fetch(`${baseUrl}/api/fournisseurs/${fournisseur.id}/reactiver`, {
    method: "POST",
    headers: authHeaders(),
  });
  assert.equal(reactivation.status, 200);
  const corpsReactivation = await reactivation.json();
  assert.equal(corpsReactivation.actif, true);
  assert.equal(corpsReactivation.id, fournisseur.id);
  assert.equal(corpsReactivation.codeFournisseur, codeInitial);
  assert.equal(corpsReactivation.nom, "PFI TEST Fournisseur Reactivation");
});

test("A7 — un fournisseur désactivé disparaît de GET /fournisseurs par défaut, mais reste listé avec inclureInactifs=true", async () => {
  const { corps: fournisseur } = await creerFournisseur("PFI TEST Fournisseur ListeInactifs");
  await fetch(`${baseUrl}/api/fournisseurs/${fournisseur.id}`, { method: "DELETE", headers: authHeaders() });

  const listeParDefaut = await fetch(`${baseUrl}/api/fournisseurs`, { headers: authHeaders() });
  const corpsParDefaut = await listeParDefaut.json();
  assert.ok(
    !corpsParDefaut.some((f: { id: number }) => f.id === fournisseur.id),
    "un fournisseur désactivé ne doit jamais apparaître dans la liste par défaut"
  );

  const listeAvecInactifs = await fetch(`${baseUrl}/api/fournisseurs?inclureInactifs=true`, { headers: authHeaders() });
  const corpsAvecInactifs = await listeAvecInactifs.json();
  const trouve = corpsAvecInactifs.find((f: { id: number }) => f.id === fournisseur.id);
  assert.ok(trouve, "le fournisseur désactivé doit apparaître avec inclureInactifs=true");
  assert.equal(trouve.actif, false);
});

test("B1 — import résolu par codeFournisseur (niveau 1) : réutilise le fournisseur actif, aucune création", async () => {
  const { corps: f } = await creerFournisseur("PFI TEST Fournisseur ParCode");
  const avant = await prisma.fournisseur.count({ where: { nom: "PFI TEST Fournisseur ParCode" } });

  const { status, corps } = await importer({
    codeFournisseur: f.codeFournisseur,
    lignes: [{ designation: "PFI TEST Article B1", reference: "PFI-B1", prix: "10.00", unite: "kg" }],
  });
  assert.equal(status, 200, JSON.stringify(corps));
  assert.equal(corps.crees, 1);

  const apres = await prisma.fournisseur.count({ where: { nom: "PFI TEST Fournisseur ParCode" } });
  assert.equal(apres, avant, "aucune création de fournisseur ne devait avoir lieu");

  const article = await prisma.article.findFirst({ where: { reference: "PFI-B1" } });
  if (article) articleIds.push(article.id);
  const tarif = await prisma.tarifArticle.findFirst({ where: { articleId: article!.id } });
  assert.equal(tarif?.fournisseurId, f.id);
});

test("B2 — codeFournisseur d'un fournisseur inactif : blocage explicite, jamais de réutilisation silencieuse", async () => {
  const { corps: f } = await creerFournisseur("PFI TEST Fournisseur Inactif B2");
  await fetch(`${baseUrl}/api/fournisseurs/${f.id}`, { method: "DELETE", headers: authHeaders() });

  const { status, corps } = await importer({
    codeFournisseur: f.codeFournisseur,
    lignes: [{ designation: "PFI TEST Article B2", reference: "PFI-B2", prix: "5.00", unite: "kg" }],
  });
  assert.equal(status, 409);
  assert.match(corps.error, /inactif/i);

  const article = await prisma.article.findFirst({ where: { reference: "PFI-B2" } });
  assert.equal(article, null, "aucun article ne devait être créé");
});

test("B3 — codeFournisseur inconnu : blocage explicite, aucune création silencieuse", async () => {
  const { status, corps } = await importer({
    codeFournisseur: "FOU-9999999",
    lignes: [{ designation: "PFI TEST Article B3", reference: "PFI-B3", prix: "5.00", unite: "kg" }],
  });
  assert.equal(status, 409);
  assert.match(corps.error, /code/i);

  const article = await prisma.article.findFirst({ where: { reference: "PFI-B3" } });
  assert.equal(article, null);
});

test("C1 — même fournisseur + même code produit : réutilisé, jamais recréé, historique de prix conservé", async () => {
  const { corps: f } = await creerFournisseur("PFI TEST Fournisseur C1");

  const r1 = await importer({
    codeFournisseur: f.codeFournisseur,
    lignes: [{ designation: "PFI TEST Article C1", reference: "PFI-C1", codeProduitFournisseur: "PROD-C1", prix: "10.00", unite: "kg" }],
  });
  assert.equal(r1.status, 200, JSON.stringify(r1.corps));
  assert.equal(r1.corps.crees, 1);

  const article = await prisma.article.findFirst({ where: { reference: "PFI-C1" } });
  articleIds.push(article!.id);

  const r2 = await importer({
    codeFournisseur: f.codeFournisseur,
    lignes: [{ designation: "PFI TEST Article C1", reference: "PFI-C1", codeProduitFournisseur: "PROD-C1", prix: "11.00", unite: "kg" }],
  });
  assert.equal(r2.status, 200, JSON.stringify(r2.corps));
  assert.equal(r2.corps.misesAJour, 1);

  const produitsFournisseur = await prisma.produitFournisseur.findMany({
    where: { fournisseurId: f.id, codeProduitFournisseur: "PROD-C1" },
  });
  assert.equal(produitsFournisseur.length, 1, "un seul ProduitFournisseur, jamais recréé à chaque changement de prix");

  const tarifs = await prisma.tarifArticle.findMany({ where: { articleId: article!.id, fournisseurId: f.id }, orderBy: { id: "asc" } });
  assert.equal(tarifs.length, 2, "historique de prix conservé (ancien clôturé, nouveau créé)");
  assert.equal(tarifs[0].actif, false);
  assert.equal(tarifs[1].actif, true);
  assert.equal(tarifs[1].prixHT, 11);
  assert.equal(tarifs[1].produitFournisseurId, produitsFournisseur[0].id);
});

test("C2 — le même code produit chez deux fournisseurs différents crée deux ProduitFournisseur distincts, jamais fusionnés", async () => {
  const { corps: fA } = await creerFournisseur("PFI TEST Fournisseur C2 A");
  const { corps: fB } = await creerFournisseur("PFI TEST Fournisseur C2 B");

  await importer({
    codeFournisseur: fA.codeFournisseur,
    lignes: [{ designation: "PFI TEST Article C2 A", reference: "PFI-C2A", codeProduitFournisseur: "45872", prix: "10.00", unite: "kg" }],
  });
  await importer({
    codeFournisseur: fB.codeFournisseur,
    lignes: [{ designation: "PFI TEST Article C2 B", reference: "PFI-C2B", codeProduitFournisseur: "45872", prix: "20.00", unite: "kg" }],
  });

  const articleA = await prisma.article.findFirst({ where: { reference: "PFI-C2A" } });
  const articleB = await prisma.article.findFirst({ where: { reference: "PFI-C2B" } });
  articleIds.push(articleA!.id, articleB!.id);

  const produits = await prisma.produitFournisseur.findMany({ where: { codeProduitFournisseur: "45872" } });
  assert.equal(produits.length, 2, "deux ProduitFournisseur distincts attendus pour le même code chez deux fournisseurs différents");
  assert.notEqual(produits[0].fournisseurId, produits[1].fournisseurId);
});

test("C3 — code produit déjà connu mais désignation très différente : alerte explicite, aucune écriture", async () => {
  const { corps: f } = await creerFournisseur("PFI TEST Fournisseur C3");
  await importer({
    codeFournisseur: f.codeFournisseur,
    lignes: [{ designation: "PFI TEST Barquette 350 ml transparente", reference: "PFI-C3", codeProduitFournisseur: "CAP-C3", prix: "5.00", unite: "kg" }],
  });
  const article = await prisma.article.findFirst({ where: { reference: "PFI-C3" } });
  articleIds.push(article!.id);
  const tarifsAvant = await prisma.tarifArticle.count({ where: { articleId: article!.id } });

  const r2 = await importer({
    codeFournisseur: f.codeFournisseur,
    lignes: [{ designation: "PFI TEST Carton de 24 bouteilles", codeProduitFournisseur: "CAP-C3", prix: "99.00", unite: "kg" }],
  });
  assert.equal(r2.status, 200, JSON.stringify(r2.corps));
  assert.equal(r2.corps.enAttente, 1);
  assert.match(r2.corps.erreurs.join(" "), /désignation/i);

  const tarifsApres = await prisma.tarifArticle.count({ where: { articleId: article!.id } });
  assert.equal(tarifsApres, tarifsAvant, "aucun nouveau tarif ne devait être écrit sur une alerte de désignation");
});

// --- TEST CRITIQUE (cadrage §17/§21/§25) : reproduit exactement le scénario CAPEMBAL/SUPER U. ---
test("D — CRITIQUE : deux fournisseurs différents sur le même article, aucun écrasement croisé de tarif", async () => {
  const { corps: capembal } = await creerFournisseur("PFI TEST CAPEMBAL");
  const { corps: superU } = await creerFournisseur("PFI TEST SUPER U");

  // Les deux imports utilisent la MÊME référence catalogue : c'est exactement ce qui, avant ce
  // chantier, faisait clôturer le tarif de A par l'import de B (correspondance par référence
  // exacte, automatique, sans confirmation — voir audit précédent).
  const rA = await importer({
    codeFournisseur: capembal.codeFournisseur,
    lignes: [{ designation: "PFI TEST Article Commun D", reference: "PFI-D-COMMUN", codeProduitFournisseur: "CAP-45872", prix: "10.00", unite: "kg" }],
  });
  assert.equal(rA.status, 200, JSON.stringify(rA.corps));
  assert.equal(rA.corps.crees, 1);

  const article = await prisma.article.findFirst({ where: { reference: "PFI-D-COMMUN" } });
  articleIds.push(article!.id);

  const rB = await importer({
    codeFournisseur: superU.codeFournisseur,
    lignes: [{ designation: "PFI TEST Article Commun D (vu par SUPER U)", reference: "PFI-D-COMMUN", codeProduitFournisseur: "CAP-45872", prix: "12.00", unite: "kg" }],
  });
  assert.equal(rB.status, 200, JSON.stringify(rB.corps));
  // L'article est retrouvé par référence catalogue partagée (comme avant ce chantier) : ce n'est
  // donc pas une "création" d'article, mais l'ouverture d'un premier tarif POUR CE FOURNISSEUR
  // (misesAJour) — un ProduitFournisseur distinct est créé pour SUPER U (fournisseurId différent de
  // celui de CAPEMBAL), jamais le même que celui de CAPEMBAL, et jamais un remplacement croisé.
  assert.equal(rB.corps.misesAJour, 1, JSON.stringify(rB.corps));
  assert.equal(rB.corps.crees, 0, JSON.stringify(rB.corps));

  const tarifCapembal = await prisma.tarifArticle.findFirst({
    where: { articleId: article!.id, fournisseurId: capembal.id },
  });
  const tarifSuperU = await prisma.tarifArticle.findFirst({
    where: { articleId: article!.id, fournisseurId: superU.id },
  });

  assert.equal(tarifCapembal?.actif, true, "le tarif de CAPEMBAL ne doit JAMAIS avoir été clôturé par l'import de SUPER U");
  assert.equal(tarifCapembal?.prixHT, 10);
  assert.equal(tarifSuperU?.actif, true);
  assert.equal(tarifSuperU?.prixHT, 12);

  const tousTarifsActifs = await prisma.tarifArticle.count({ where: { articleId: article!.id, actif: true } });
  assert.equal(tousTarifsActifs, 2, "les deux fournisseurs doivent avoir simultanément un tarif actif pour le même article");

  // Soft-delete de CAPEMBAL : conserve tout, n'affecte jamais SUPER U.
  const suppr = await fetch(`${baseUrl}/api/fournisseurs/${capembal.id}`, { method: "DELETE", headers: authHeaders() });
  assert.equal(suppr.status, 204);

  const capembalApres = await prisma.fournisseur.findUnique({ where: { id: capembal.id } });
  assert.equal(capembalApres?.actif, false);
  assert.equal(capembalApres?.codeFournisseur, capembal.codeFournisseur);

  const tarifCapembalApres = await prisma.tarifArticle.findFirst({ where: { articleId: article!.id, fournisseurId: capembal.id } });
  assert.equal(tarifCapembalApres?.actif, true, "le tarif de CAPEMBAL reste intact après son propre soft-delete");
  assert.equal(tarifCapembalApres?.prixHT, 10);

  const tarifSuperUApres = await prisma.tarifArticle.findFirst({ where: { articleId: article!.id, fournisseurId: superU.id } });
  assert.equal(tarifSuperUApres?.actif, true);
  assert.equal(tarifSuperUApres?.prixHT, 12, "SUPER U doit rester totalement inchangé par la suppression de CAPEMBAL");
});
