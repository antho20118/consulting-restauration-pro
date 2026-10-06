import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import prisma from "../../server/prisma.js";

// Test d'intégration réel (vrai Postgres, aucun mock) du schéma Prisma ajouté en Phase 2 du
// chantier listings/factures fournisseurs — DocumentFournisseur / LigneDocumentFournisseur. Ne
// couvre PAS le moteur de rapprochement (Phase 3, pas encore modifié) : ces tests écrivent les
// champs directement, comme le fera plus tard le moteur.

let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteId: number;
let conditionnementId: number;
let fournisseurId: number;
const articleIds: number[] = [];
const documentIds: number[] = [];
const tarifIds: number[] = [];

before(async () => {
  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie =
    (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const unite =
    (await prisma.unite.findFirst()) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteId = unite.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Carton" } }));
  conditionnementId = conditionnement.id;

  const fournisseur = await prisma.fournisseur.create({
    data: { nom: "DOCUMENT FOURNISSEUR SCHEMA TEST", societeId },
  });
  fournisseurId = fournisseur.id;
});

after(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.tarifArticle.deleteMany({ where: { id: { in: tarifIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
});

test("traçabilité complète Article → TarifArticle → LigneDocumentFournisseur → DocumentFournisseur", async () => {
  const article = await prisma.article.create({
    data: {
      type: "MATIERE_PREMIERE",
      nom: "DOCUMENT FOURNISSEUR SCHEMA TEST Escalope de veau",
      categorieId,
      tvaId,
      societeId,
    },
  });
  articleIds.push(article.id);

  const document = await prisma.documentFournisseur.create({
    data: {
      fournisseurId,
      type: "FACTURE",
      cle: "11111111-1111-4111-8111-111111111111",
      typeMime: "image/jpeg",
      tailleOctets: 12345,
      numero: "FA-1548",
      montantTotal: 62.5,
    },
  });
  documentIds.push(document.id);

  const tarif = await prisma.tarifArticle.create({
    data: {
      articleId: article.id,
      fournisseurId,
      uniteId,
      conditionnementId,
      quantiteConditionnement: 5,
      prixHT: 12.5,
    },
  });
  tarifIds.push(tarif.id);

  const ligne = await prisma.ligneDocumentFournisseur.create({
    data: {
      documentId: document.id,
      designationLue: "ESCALOPE DE VEAU 5 KG",
      prixLu: 62.5,
      natureLigne: "ARTICLE",
      articleProposeId: article.id,
      confiance: 0.92,
      motifCorrespondance: "DESIGNATION_APPROXIMATIVE",
      decision: "VALIDEE",
      articleRetenuId: article.id,
      tarifCreeId: tarif.id,
    },
  });

  // Remontée complète dans l'autre sens, comme le fera l'écran historique (Phase 7) : depuis le
  // tarif, retrouver la ligne puis le document source.
  const tarifAvecSource = await prisma.tarifArticle.findUniqueOrThrow({
    where: { id: tarif.id },
    include: { ligneDocumentSource: { include: { document: true } } },
  });
  assert.equal(tarifAvecSource.ligneDocumentSource?.id, ligne.id);
  assert.equal(tarifAvecSource.ligneDocumentSource?.document.numero, "FA-1548");
  assert.equal(tarifAvecSource.ligneDocumentSource?.document.montantTotal, 62.5);

  // Et depuis l'article, les deux relations nommées ne se confondent jamais.
  const articleAvecLignes = await prisma.article.findUniqueOrThrow({
    where: { id: article.id },
    include: { lignesDocumentPropose: true, lignesDocumentRetenu: true },
  });
  assert.equal(articleAvecLignes.lignesDocumentPropose.length, 1);
  assert.equal(articleAvecLignes.lignesDocumentRetenu.length, 1);
  assert.equal(articleAvecLignes.lignesDocumentPropose[0].id, ligne.id);
});

test("un tarif créé avant ce chantier (sans ligne source) reste parfaitement valide", async () => {
  const article = await prisma.article.create({
    data: {
      type: "MATIERE_PREMIERE",
      nom: "DOCUMENT FOURNISSEUR SCHEMA TEST Sans Source",
      categorieId,
      tvaId,
      societeId,
    },
  });
  articleIds.push(article.id);

  const tarifSansSource = await prisma.tarifArticle.create({
    data: {
      articleId: article.id,
      fournisseurId,
      uniteId,
      conditionnementId,
      quantiteConditionnement: 1,
      prixHT: 9.9,
    },
  });
  tarifIds.push(tarifSansSource.id);

  const relu = await prisma.tarifArticle.findUniqueOrThrow({
    where: { id: tarifSansSource.id },
    include: { ligneDocumentSource: true },
  });
  assert.equal(relu.ligneDocumentSource, null);
});

test("un même tarif ne peut pas être rattaché à deux lignes différentes (contrainte unique tarifCreeId)", async () => {
  const article = await prisma.article.create({
    data: {
      type: "MATIERE_PREMIERE",
      nom: "DOCUMENT FOURNISSEUR SCHEMA TEST Contrainte Unique",
      categorieId,
      tvaId,
      societeId,
    },
  });
  articleIds.push(article.id);

  const document = await prisma.documentFournisseur.create({
    data: {
      fournisseurId,
      type: "LISTING",
      cle: "22222222-2222-4222-8222-222222222222",
      typeMime: "image/png",
      tailleOctets: 100,
    },
  });
  documentIds.push(document.id);

  const tarif = await prisma.tarifArticle.create({
    data: {
      articleId: article.id,
      fournisseurId,
      uniteId,
      conditionnementId,
      quantiteConditionnement: 1,
      prixHT: 5,
    },
  });
  tarifIds.push(tarif.id);

  await prisma.ligneDocumentFournisseur.create({
    data: { documentId: document.id, designationLue: "Ligne A", tarifCreeId: tarif.id },
  });

  await assert.rejects(
    prisma.ligneDocumentFournisseur.create({
      data: { documentId: document.id, designationLue: "Ligne B (même tarif)", tarifCreeId: tarif.id },
    })
  );
});

test("supprimer un DocumentFournisseur supprime ses lignes (CASCADE) sans toucher à l'article ni au tarif", async () => {
  const article = await prisma.article.create({
    data: {
      type: "MATIERE_PREMIERE",
      nom: "DOCUMENT FOURNISSEUR SCHEMA TEST Cascade Document",
      categorieId,
      tvaId,
      societeId,
    },
  });
  articleIds.push(article.id);

  const document = await prisma.documentFournisseur.create({
    data: {
      fournisseurId,
      type: "LISTING",
      cle: "33333333-3333-4333-8333-333333333333",
      typeMime: "image/png",
      tailleOctets: 100,
    },
  });

  const ligne = await prisma.ligneDocumentFournisseur.create({
    data: { documentId: document.id, designationLue: "Ligne à supprimer avec son document", articleProposeId: article.id },
  });

  await prisma.documentFournisseur.delete({ where: { id: document.id } });

  const ligneEncore = await prisma.ligneDocumentFournisseur.findUnique({ where: { id: ligne.id } });
  assert.equal(ligneEncore, null, "la ligne doit disparaître avec son document (CASCADE)");

  const articleEncore = await prisma.article.findUnique({ where: { id: article.id } });
  assert.ok(articleEncore, "l'article référencé ne doit jamais être supprimé par la suppression du document");
});

test("supprimer un article référencé par une ligne met la référence à null (SET NULL) sans supprimer la ligne", async () => {
  const articleJetable = await prisma.article.create({
    data: {
      type: "CONSOMMABLE",
      nom: "DOCUMENT FOURNISSEUR SCHEMA TEST Article Jetable",
      categorieId,
      tvaId,
      societeId,
    },
  });

  const document = await prisma.documentFournisseur.create({
    data: {
      fournisseurId,
      type: "LISTING",
      cle: "44444444-4444-4444-8444-444444444444",
      typeMime: "image/png",
      tailleOctets: 100,
    },
  });
  documentIds.push(document.id);

  const ligne = await prisma.ligneDocumentFournisseur.create({
    data: {
      documentId: document.id,
      designationLue: "Ligne dont l'article proposé sera supprimé",
      articleProposeId: articleJetable.id,
    },
  });

  await prisma.article.delete({ where: { id: articleJetable.id } });

  const ligneApres = await prisma.ligneDocumentFournisseur.findUniqueOrThrow({ where: { id: ligne.id } });
  assert.equal(ligneApres.articleProposeId, null, "la référence doit être annulée, jamais la ligne elle-même");
});
