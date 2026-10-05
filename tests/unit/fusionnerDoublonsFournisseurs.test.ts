import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import prisma from "../../server/prisma.js";
import { fusionnerGroupe, MARQUEUR_FUSIONNE } from "../../prisma/fusionnerDoublonsFournisseurs.js";

// Test d'intégration réel (vrai Postgres) — script de fusion de fiches fournisseur en doublon
// (demande utilisateur : « Fusionne les doublons Super U et VIBEL »). Couvre le point critique
// identifié avant l'écriture du script : la résolution des collisions de tarifs actifs (deux
// fiches doublon peuvent chacune avoir un tarif actif pour le même article — après fusion brute,
// on se retrouverait avec deux tarifs actifs pour le même (article, fournisseur), cassant
// l'invariant applicatif "un seul tarif actif par couple article+fournisseur"), la détection de
// collision de code produit fournisseur (jamais un écrasement silencieux), l'idempotence, et le
// garde-fou société.

let societeId: number;
let societeAutreId: number;
let categorieId: number;
let tvaId: number;
let uniteId: number;
let conditionnementId: number;

// codeFournisseur toujours renseigné (jamais null) : un null ici est incident au test — ce fichier
// teste la logique de fusion, pas la génération de code — et un fournisseur de test sans code
// interfère avec le test d'idempotence global du script de rattrapage des codes manquants
// (codeFournisseurCreationAutomatique.test.ts, qui vérifie qu'aucun fournisseur en base n'a un code
// null, tous fichiers de test confondus, node --test exécutant les fichiers en parallèle).
let compteurCode = 0;
function creerFournisseur(nom: string, societe = societeId) {
  compteurCode += 1;
  return prisma.fournisseur.create({
    data: { nom, societeId: societe, codeFournisseur: `FUSION-TEST-${Date.now()}-${compteurCode}` },
  });
}

function creerArticle(nom: string) {
  return prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom, categorieId, tvaId, societeId },
  });
}

function creerTarif(articleId: number, fournisseurId: number, prixHT: number, actif: boolean, dateDebut: Date) {
  return prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId, conditionnementId, quantiteConditionnement: 1, prixHT, actif, dateDebut },
  });
}

before(async () => {
  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const unite =
    (await prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteId = unite.id;
  const conditionnement = (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Carton" } }));
  conditionnementId = conditionnement.id;

  const societeAutre = await prisma.societe.create({ data: { nom: "FUSION TEST Société Autre" } });
  societeAutreId = societeAutre.id;
});

after(async () => {
  const fournisseurs = await prisma.fournisseur.findMany({
    where: { nom: { contains: "FUSION TEST" } },
    select: { id: true },
  });
  const ids = fournisseurs.map((f) => f.id);
  await prisma.tarifArticle.deleteMany({ where: { OR: [{ fournisseurId: { in: ids } }, { article: { nom: { startsWith: "FUSION TEST" } } }] } });
  await prisma.produitFournisseur.deleteMany({ where: { fournisseurId: { in: ids } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId: { in: ids } } });
  await prisma.article.deleteMany({ where: { nom: { startsWith: "FUSION TEST" } } });
  await prisma.fournisseur.deleteMany({ where: { id: { in: ids } } });
  await prisma.societe.deleteMany({ where: { nom: "FUSION TEST Société Autre" } });
});

test("1. réassignation simple : tarifs et documents déplacés, fiche absorbée désactivée et marquée", async () => {
  const conserver = await creerFournisseur("FUSION TEST Conserver A");
  const absorber = await creerFournisseur("FUSION TEST Absorber A");
  const article = await creerArticle("FUSION TEST Article A1");
  const tarif = await creerTarif(article.id, absorber.id, 10, true, new Date("2024-01-01"));
  const document = await prisma.documentFournisseur.create({
    data: {
      fournisseurId: absorber.id,
      type: "LISTING",
      cle: `fusion-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      typeMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      tailleOctets: 1024,
      nomFichierOriginal: "test.xlsx",
    },
  });

  await fusionnerGroupe({ conserverId: conserver.id, absorberIds: [absorber.id], libelle: "Test A" });

  const tarifApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarif.id } });
  assert.equal(tarifApres.fournisseurId, conserver.id);
  assert.equal(tarifApres.actif, true, "le tarif seul (pas de collision) reste actif");

  const documentApres = await prisma.documentFournisseur.findUniqueOrThrow({ where: { id: document.id } });
  assert.equal(documentApres.fournisseurId, conserver.id);

  const absorbeApres = await prisma.fournisseur.findUniqueOrThrow({ where: { id: absorber.id } });
  assert.equal(absorbeApres.actif, false);
  assert.ok(absorbeApres.nom.startsWith(MARQUEUR_FUSIONNE), `le nom doit porter le marqueur, reçu: "${absorbeApres.nom}"`);
  assert.match(absorbeApres.nom, new RegExp(`#${conserver.id}`), "le nom doit référencer la fiche conservée");
});

test("2. collision de tarifs actifs : le plus récent reste actif, l'autre est historisé", async () => {
  const conserver = await creerFournisseur("FUSION TEST Conserver B");
  const absorber = await creerFournisseur("FUSION TEST Absorber B");
  const article = await creerArticle("FUSION TEST Article B1");

  const tarifAncienConserve = await creerTarif(article.id, conserver.id, 5, true, new Date("2023-01-01"));
  const tarifRecentAbsorbe = await creerTarif(article.id, absorber.id, 6, true, new Date("2024-06-01"));

  await fusionnerGroupe({ conserverId: conserver.id, absorberIds: [absorber.id], libelle: "Test B" });

  const ancienApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifAncienConserve.id } });
  const recentApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifRecentAbsorbe.id } });

  assert.equal(ancienApres.actif, false, "le tarif le plus ancien doit être historisé");
  assert.ok(ancienApres.dateFin, "dateFin doit être renseignée sur le tarif historisé");
  assert.equal(recentApres.actif, true, "le tarif le plus récent reste actif");
  assert.equal(recentApres.fournisseurId, conserver.id);

  const tarifsActifsArticle = await prisma.tarifArticle.findMany({
    where: { articleId: article.id, fournisseurId: conserver.id, actif: true },
  });
  assert.equal(tarifsActifsArticle.length, 1, "jamais deux tarifs actifs pour le même (article, fournisseur) après fusion");
});

test("3. collision de code produit fournisseur : la fusion s'arrête, rien n'est modifié", async () => {
  const conserver = await creerFournisseur("FUSION TEST Conserver C");
  const absorber = await creerFournisseur("FUSION TEST Absorber C");
  const article1 = await creerArticle("FUSION TEST Article C1");
  const article2 = await creerArticle("FUSION TEST Article C2");

  await prisma.produitFournisseur.create({
    data: { fournisseurId: conserver.id, codeProduitFournisseur: "DUP-001", articleId: article1.id, designationConnue: "Conservé" },
  });
  await prisma.produitFournisseur.create({
    data: { fournisseurId: absorber.id, codeProduitFournisseur: "DUP-001", articleId: article2.id, designationConnue: "Absorbé" },
  });
  const tarifTemoin = await creerTarif(article2.id, absorber.id, 7, true, new Date());

  await assert.rejects(
    () => fusionnerGroupe({ conserverId: conserver.id, absorberIds: [absorber.id], libelle: "Test C" }),
    /Collision de code produit fournisseur/
  );

  // Rien n'a dû être modifié : la transaction entière a été annulée.
  const tarifApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarifTemoin.id } });
  assert.equal(tarifApres.fournisseurId, absorber.id, "aucune réassignation ne doit avoir eu lieu, transaction annulée");
  const absorbeApres = await prisma.fournisseur.findUniqueOrThrow({ where: { id: absorber.id } });
  assert.equal(absorbeApres.actif, true, "la fiche absorbée ne doit pas avoir été désactivée si la fusion a échoué");
});

test("4. idempotence : une seconde exécution sur un groupe déjà fusionné ne fait rien", async () => {
  const conserver = await creerFournisseur("FUSION TEST Conserver D");
  const absorber = await creerFournisseur("FUSION TEST Absorber D");
  const article = await creerArticle("FUSION TEST Article D1");
  const tarif = await creerTarif(article.id, absorber.id, 8, true, new Date());

  await fusionnerGroupe({ conserverId: conserver.id, absorberIds: [absorber.id], libelle: "Test D" });
  const apresPremiere = await prisma.fournisseur.findUniqueOrThrow({ where: { id: absorber.id } });

  // Seconde exécution : ne doit ni échouer, ni re-préfixer le nom, ni retoucher le tarif.
  await fusionnerGroupe({ conserverId: conserver.id, absorberIds: [absorber.id], libelle: "Test D" });
  const apresSeconde = await prisma.fournisseur.findUniqueOrThrow({ where: { id: absorber.id } });
  assert.equal(apresSeconde.nom, apresPremiere.nom, "le nom ne doit pas être re-préfixé une seconde fois");

  const tarifApres = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarif.id } });
  assert.equal(tarifApres.fournisseurId, conserver.id);
});

test("5. garde-fou société : refuse de fusionner des fournisseurs de sociétés différentes", async () => {
  const conserver = await creerFournisseur("FUSION TEST Conserver E");
  const absorberAutreSociete = await creerFournisseur("FUSION TEST Absorber E", societeAutreId);

  await assert.rejects(
    () => fusionnerGroupe({ conserverId: conserver.id, absorberIds: [absorberAutreSociete.id], libelle: "Test E" }),
    /n'appartient pas à la même société/
  );

  const absorbeApres = await prisma.fournisseur.findUniqueOrThrow({ where: { id: absorberAutreSociete.id } });
  assert.equal(absorbeApres.actif, true, "aucune modification si le garde-fou société se déclenche");
});

test("6. plusieurs fiches absorbées en une fois : toutes réassignées et marquées vers la même fiche conservée", async () => {
  const conserver = await creerFournisseur("FUSION TEST Conserver F");
  const absorber1 = await creerFournisseur("FUSION TEST Absorber F1");
  const absorber2 = await creerFournisseur("FUSION TEST Absorber F2");
  const article1 = await creerArticle("FUSION TEST Article F1");
  const article2 = await creerArticle("FUSION TEST Article F2");
  const tarif1 = await creerTarif(article1.id, absorber1.id, 3, true, new Date());
  const tarif2 = await creerTarif(article2.id, absorber2.id, 4, true, new Date());

  await fusionnerGroupe({ conserverId: conserver.id, absorberIds: [absorber1.id, absorber2.id], libelle: "Test F" });

  const t1 = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarif1.id } });
  const t2 = await prisma.tarifArticle.findUniqueOrThrow({ where: { id: tarif2.id } });
  assert.equal(t1.fournisseurId, conserver.id);
  assert.equal(t2.fournisseurId, conserver.id);

  const a1 = await prisma.fournisseur.findUniqueOrThrow({ where: { id: absorber1.id } });
  const a2 = await prisma.fournisseur.findUniqueOrThrow({ where: { id: absorber2.id } });
  assert.equal(a1.actif, false);
  assert.equal(a2.actif, false);
});
