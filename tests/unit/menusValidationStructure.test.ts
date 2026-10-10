import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest, creerUtilisateurAutreSocieteDeTest } from "../helpers/auth.js";

// Chantier CONSULTING RESTAURATION PRO — MENUS POST/PUT : server/routes/menus.ts lisait nom/
// description/categorieId/prixVenteHT/lignes[].recetteId,quantite par simple cast TypeScript,
// jamais par Zod — seules l'existence de categorieId et l'appartenance société des recetteId
// étaient vérifiées (voir tests/unit/menusIsolationSociete.test.ts, chantier F09/F10 du
// 2026-10-07, non remis en cause ici). Un type incorrect sur l'un de ces champs atteint
// directement prisma.menu.create / tx.menu.update et y provoque une PrismaClientValidationError
// (jamais interceptée par repondreErreurEcriture, qui ne traduit que des codes Prisma P2xxx),
// donc un 500 — confirmé empiriquement ci-dessous (RED). Un identifiant hors des bornes réelles du
// stockage Postgres (INT4, voir server/routes/articles.ts::ID_POSTGRES_MIN/MAX) atteint le driver
// Postgres lui-même (ConnectorError), également un 500 non intercepté.
//
// Second défaut, distinct : calculerCoutMenu (server/utils/coutMenu.ts) est actuellement appelé
// APRÈS que l'écriture a déjà committé (après prisma.menu.create en POST ; après la résolution du
// prisma.$transaction en PUT, hors de son callback) — si ce calcul lève (recette référencée
// devenue impossible à chiffrer), le menu a réellement été créé/modifié en base, mais le client
// reçoit un 500 "impossible de créer/modifier le menu" : un faux négatif de succès. Pattern déjà
// corrigé dans server/routes/recettes.ts (calculerCoutRecette appelé DANS la transaction, voir son
// commentaire) — jamais reporté sur menus.ts. Aucun chemin applicatif validé ne permet aujourd'hui
// de produire un état qui fait réellement échouer calculerCoutRecette sur une recette existante
// (rendement d'article borné ]0,1000] par Zod, prixHT>=0, quantiteConditionnement toujours 1,
// facteurBase d'unité toujours positif, portions de recette toujours >0 — chacun déjà vérifié à
// l'écriture) : la preuve ci-dessous corrompt donc délibérément un article existant directement
// via Prisma (jamais via l'API), pour reproduire l'état réel que rendementValide() rejette — un
// scénario de fixture corrompue, pas un défaut métier atteignable par l'application elle-même.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
// CategorieRecette (menus/recettes) et Categorie (articles) sont deux tables distinctes, chacune
// avec sa propre séquence d'id — jamais interchangeables même si une valeur numérique coïncide
// par hasard. categorieId sert exclusivement aux menus (CategorieRecette) ; categorieArticleId
// sert exclusivement à la fixture d'article (Categorie), voir creerArticleTarifeDeTest.
let categorieId: number;
let categorieArticleId: number;

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function poster(chemin: string, corpsPayload: unknown) {
  const reponse = await fetch(`${baseUrl}${chemin}`, { method: "POST", headers: authHeaders(), body: JSON.stringify(corpsPayload) });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
}

async function mettreAJour(chemin: string, corpsPayload: unknown) {
  const reponse = await fetch(`${baseUrl}${chemin}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(corpsPayload) });
  const corps = await reponse.json().catch(() => null);
  return { status: reponse.status, corps };
}

// Créée via l'API réelle (POST /api/articles), pas via Prisma direct : TarifArticle a des FK
// obligatoires (fournisseurId, conditionnementId) que resoudreFournisseurOuLever résout depuis
// fournisseurNom — reproduire cette résolution à la main dans chaque test serait redondant et
// risquerait de diverger du contrat réel.
async function creerArticleTarifeDeTest(nom: string, unite: { id: number }, tva: { id: number }) {
  const reponse = await poster("/api/articles", {
    nom,
    type: "MATIERE_PREMIERE",
    rendement: 100,
    categorieId: categorieArticleId,
    tvaId: tva.id,
    uniteId: unite.id,
    prixHT: 10,
    fournisseurNom: `MENUS VALIDATION TEST Fournisseur ${randomUUID()}`,
  });
  assert.equal(reponse.status, 201, "précondition de test : création de l'article tarifé doit réussir");
  return { id: reponse.corps.id as number };
}

async function creerRecetteDeTest(nom: string, articleId: number, uniteId: number): Promise<number> {
  const recette = await prisma.recette.create({
    data: {
      nom,
      societeId,
      portions: 1,
      lignes: { create: [{ articleId, quantite: 1, uniteId, ordre: 0 }] },
    },
  });
  return recette.id;
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
  const categorie = (await prisma.categorieRecette.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ?? (await prisma.categorieRecette.create({ data: { nom: "Catégorie recette de test", societeId } }));
  categorieId = categorie.id;
  // Table distincte de CategorieRecette ci-dessus (voir le commentaire de la déclaration des
  // variables) : jamais réutiliser categorieId pour un article, même si les valeurs numériques
  // pouvaient coïncider par hasard sur une base fraîche.
  const categorieArticle =
    (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ??
    (await prisma.categorie.create({ data: { nom: "Catégorie article de test", societeId } }));
  categorieArticleId = categorieArticle.id;
});

// Le serveur doit toujours être fermé, même si le nettoyage ci-dessous échoue (sans quoi le port
// reste occupé) — mais un échec de nettoyage ne doit jamais être masqué : il doit faire échouer ce
// hook et apparaître dans les résultats, pas être avalé silencieusement.
after(async () => {
  try {
    const menus = await prisma.menu.findMany({ where: { nom: { startsWith: "MENUS VALIDATION TEST" } }, select: { id: true } });
    const menuIds = menus.map((m) => m.id);
    await prisma.menuLigne.deleteMany({ where: { menuId: { in: menuIds } } });
    await prisma.menu.deleteMany({ where: { id: { in: menuIds } } });
    await prisma.recetteLigne.deleteMany({ where: { recette: { nom: { startsWith: "MENUS VALIDATION TEST" } } } });
    await prisma.recette.deleteMany({ where: { nom: { startsWith: "MENUS VALIDATION TEST" } } });
    await prisma.tarifArticle.deleteMany({ where: { article: { nom: { startsWith: "MENUS VALIDATION TEST" } } } });
    await prisma.article.deleteMany({ where: { nom: { startsWith: "MENUS VALIDATION TEST" } } });
    await prisma.fournisseur.deleteMany({ where: { nom: { startsWith: "MENUS VALIDATION TEST" } } });
    // Unite/TVA déterministes créées fraîches pour I1/I2 (voir creerUniteDeterministeDeTest /
    // creerTvaDeterministeDeTest) : jamais partagées (nom unique par randomUUID à chaque appel),
    // doivent donc être supprimées ici pour ne pas s'accumuler à chaque exécution — après les
    // RecetteLigne/TarifArticle qui les référencent (déjà supprimés ci-dessus).
    await prisma.unite.deleteMany({ where: { nom: { startsWith: "Unite coût déterministe" } } });
    await prisma.tVA.deleteMany({ where: { nom: { startsWith: "TVA coût déterministe" } } });
    // categorieId/categorieArticleId (ci-dessus, before()) sont des fixtures partagées
    // find-or-create, potentiellement réutilisées par d'autres fichiers de test exécutés en
    // parallèle sur la même base : jamais supprimées ici, même convention que le reste de cet
    // engagement (ex. "Société de test" elle-même n'est jamais supprimée non plus).
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

// --- A. nom de type malformé ---

test("RED/GREEN A1 : POST /api/menus avec nom numérique (123) -> 400, aucun menu créé", async () => {
  // nom lui-même étant le champ malformé (un number, pas une chaîne), impossible de le chercher
  // tel quel dans une colonne String : un marqueur unique sur description (une chaîne, valide)
  // identifie la tentative sans dépendre d'un comptage global par société, partagé avec les
  // autres fichiers de test exécutés en parallèle sur la même base.
  const marqueur = `MENUS VALIDATION TEST A1 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom: 12345, description: marqueur, lignes: [] });
  assert.equal(reponse.status, 400, "un nom numérique doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { description: marqueur } });
  assert.equal(menuCree, null, "aucun menu ne doit avoir été créé après ce refus");
});

test("RED/GREEN A2 : PUT /api/menus/:id avec nom objet ({}) -> 400, menu intégralement inchangé", async () => {
  const nom = `MENUS VALIDATION TEST A2 ${randomUUID()}`;
  const creation = await poster("/api/menus", { nom, lignes: [] });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;
  const avant = await prisma.menu.findUniqueOrThrow({ where: { id: menuId } });

  const reponse = await mettreAJour(`/api/menus/${menuId}`, { nom: {}, lignes: [] });
  assert.equal(reponse.status, 400, "un nom objet doit être un refus 400, jamais un 500 ni un succès 200");
  const apres = await prisma.menu.findUniqueOrThrow({ where: { id: menuId } });
  assert.deepEqual(apres, avant, "le menu complet doit rester strictement identique après ce refus");
});

// --- B. description de type malformé / null / absente (comportements historiques) ---

test("GREEN B1 : POST /api/menus avec description explicitement null -> comportement historique préservé, jamais un refus", async () => {
  const nom = `MENUS VALIDATION TEST B1 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, description: null, lignes: [] });
  assert.equal(reponse.status, 201, "description null n'a jamais été refusée avant ce correctif");
  assert.equal(reponse.corps.description, null);
});

test("GREEN B2 : POST /api/menus sans la clé description -> créé avec description null (comportement absent préservé)", async () => {
  const nom = `MENUS VALIDATION TEST B2 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [] });
  assert.equal(reponse.status, 201);
  assert.equal(reponse.corps.description, null);
});

test("GREEN B3 : PUT /api/menus/:id sans la clé description -> remise à null (comportement de remplacement intégral préservé, PAS une mise à jour partielle)", async () => {
  const nom = `MENUS VALIDATION TEST B3 ${randomUUID()}`;
  const creation = await poster("/api/menus", { nom, description: "description initiale", lignes: [] });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;

  const miseAJour = await mettreAJour(`/api/menus/${menuId}`, { nom, lignes: [] });
  assert.equal(miseAJour.status, 200);
  const relu = await prisma.menu.findUniqueOrThrow({ where: { id: menuId } });
  assert.equal(relu.description, null, "PUT remplace intégralement : une clé omise doit remettre le champ à null, jamais conserver l'ancienne valeur");
});

test("RED/GREEN B4 : POST /api/menus avec description objet ({}) -> 400, rien créé", async () => {
  const nom = `MENUS VALIDATION TEST B4 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, description: {}, lignes: [] });
  assert.equal(reponse.status, 400, "une description objet doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

// --- C. categorieId malformé / hors bornes / inexistant / null / absent ---

test("RED/GREEN C1 : POST /api/menus avec categorieId chaîne (\"abc\") -> 400, rien créé", async () => {
  const nom = `MENUS VALIDATION TEST C1 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, categorieId: "abc", lignes: [] });
  assert.equal(reponse.status, 400, "un categorieId chaîne doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

test("RED/GREEN C2 : POST /api/menus avec categorieId = 2147483648 (1 au-dessus de la borne INT4) -> 400, rien créé", async () => {
  const nom = `MENUS VALIDATION TEST C2 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, categorieId: 2147483648, lignes: [] });
  assert.equal(reponse.status, 400, "un categorieId hors bornes INT4 doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

test("RED/GREEN C3 : POST /api/menus avec categorieId = 9007199254740991 (Number.MAX_SAFE_INTEGER, hors INT4) -> 400, rien créé", async () => {
  const nom = `MENUS VALIDATION TEST C3 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, categorieId: 9007199254740991, lignes: [] });
  assert.equal(reponse.status, 400, "un categorieId hors bornes INT4 doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

test("GREEN C4 : POST /api/menus avec categorieId = 2147483647 (borne haute INT4 valide, inexistante) -> 400 (déjà sûr, non-régression)", async () => {
  const nom = `MENUS VALIDATION TEST C4 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, categorieId: 2147483647, lignes: [] });
  assert.equal(reponse.status, 400, "un categorieId représentable mais inexistant doit rester un refus propre, non-régression");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

test("GREEN C5 : POST /api/menus avec categorieId explicitement null -> accepté, aucune catégorie (comportement historique préservé)", async () => {
  const nom = `MENUS VALIDATION TEST C5 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, categorieId: null, lignes: [] });
  assert.equal(reponse.status, 201);
  assert.equal(reponse.corps.categorieId, null);
});

test("GREEN C6 : POST /api/menus sans la clé categorieId -> accepté, aucune catégorie (comportement absent préservé)", async () => {
  const nom = `MENUS VALIDATION TEST C6 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [] });
  assert.equal(reponse.status, 201);
  assert.equal(reponse.corps.categorieId, null);
});

test("GREEN C7 : PUT /api/menus/:id sans la clé categorieId -> remise à null (remplacement intégral préservé)", async () => {
  const nom = `MENUS VALIDATION TEST C7 ${randomUUID()}`;
  const creation = await poster("/api/menus", { nom, categorieId, lignes: [] });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;

  const miseAJour = await mettreAJour(`/api/menus/${menuId}`, { nom, lignes: [] });
  assert.equal(miseAJour.status, 200);
  const relu = await prisma.menu.findUniqueOrThrow({ where: { id: menuId } });
  assert.equal(relu.categorieId, null, "PUT remplace intégralement : categorieId omis doit être remis à null");
});

test("GREEN C8 : categorieId d'une autre société : POST -> 400, aucun menu créé", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const autreCategorie = await prisma.categorieRecette.create({ data: { nom: "Cat étrangère menus", societeId: autreSociete.societeId } });
  try {
    const nom = `MENUS VALIDATION TEST C8 ${randomUUID()}`;
    const reponse = await poster("/api/menus", { nom, categorieId: autreCategorie.id, lignes: [] });
    assert.equal(reponse.status, 400, "une catégorie d'une autre société ne doit jamais être acceptée");
    const menuCree = await prisma.menu.findFirst({ where: { nom } });
    assert.equal(menuCree, null);
  } finally {
    // Ordre imposé par les relations du schéma : Utilisateur et CategorieRecette référencent
    // Societe (pas de cascade) — Societe ne peut être supprimée qu'une fois ces deux lignes
    // parties. Aucun .catch(() => {}) : un échec de nettoyage doit faire échouer ce test, pas
    // être masqué (creerUtilisateurAutreSocieteDeTest crée exactement un utilisateur pour cette
    // société, voir tests/helpers/auth.ts).
    await prisma.utilisateur.deleteMany({ where: { societeId: autreSociete.societeId } });
    await prisma.categorieRecette.delete({ where: { id: autreCategorie.id } });
    await prisma.societe.delete({ where: { id: autreSociete.societeId } });
  }
});

// --- D. prixVenteHT malformé / négatif / null / absent ---

test("RED/GREEN D1 : POST /api/menus avec prixVenteHT chaîne (\"abc\") -> 400, rien créé", async () => {
  const nom = `MENUS VALIDATION TEST D1 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, prixVenteHT: "abc", lignes: [] });
  assert.equal(reponse.status, 400, "un prixVenteHT chaîne doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

test("GREEN D2 : POST /api/menus avec prixVenteHT négatif -> comportement historique préservé, accepté (aucun crash associé, aucune nouvelle règle métier ajoutée)", async () => {
  const nom = `MENUS VALIDATION TEST D2 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, prixVenteHT: -5, lignes: [] });
  assert.equal(reponse.status, 201, "prixVenteHT négatif n'a jamais crashé avant ce correctif : il ne doit pas devenir un refus sans justification démontrée");
  assert.equal(reponse.corps.prixVenteHT, -5);
});

test("GREEN D3 : POST /api/menus avec prixVenteHT explicitement null -> accepté (comportement historique préservé)", async () => {
  const nom = `MENUS VALIDATION TEST D3 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, prixVenteHT: null, lignes: [] });
  assert.equal(reponse.status, 201);
  assert.equal(reponse.corps.prixVenteHT, null);
});

test("GREEN D4 : POST /api/menus sans la clé prixVenteHT -> accepté, null (comportement absent préservé)", async () => {
  const nom = `MENUS VALIDATION TEST D4 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [] });
  assert.equal(reponse.status, 201);
  assert.equal(reponse.corps.prixVenteHT, null);
});

test("GREEN D5 : PUT /api/menus/:id sans la clé prixVenteHT -> remise à null (remplacement intégral préservé)", async () => {
  const nom = `MENUS VALIDATION TEST D5 ${randomUUID()}`;
  const creation = await poster("/api/menus", { nom, prixVenteHT: 15.5, lignes: [] });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;

  const miseAJour = await mettreAJour(`/api/menus/${menuId}`, { nom, lignes: [] });
  assert.equal(miseAJour.status, 200);
  const relu = await prisma.menu.findUniqueOrThrow({ where: { id: menuId } });
  assert.equal(relu.prixVenteHT, null, "PUT remplace intégralement : prixVenteHT omis doit être remis à null");
});

// --- E. lignes malformées (élément non-objet, recetteId/quantite de mauvais type) ---

test("RED/GREEN E1 : POST /api/menus avec lignes = [null] -> 400, rien créé", async () => {
  const nom = `MENUS VALIDATION TEST E1 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [null] });
  assert.equal(reponse.status, 400, "un élément null dans lignes doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

test("RED/GREEN E2 : POST /api/menus avec lignes = [42] -> 400, rien créé", async () => {
  const nom = `MENUS VALIDATION TEST E2 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [42] });
  assert.equal(reponse.status, 400, "un élément non-objet dans lignes doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

test("RED/GREEN E3 : POST /api/menus avec lignes[0].recetteId chaîne (\"abc\") -> 400, rien créé", async () => {
  const nom = `MENUS VALIDATION TEST E3 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [{ recetteId: "abc", quantite: 1 }] });
  assert.equal(reponse.status, 400, "un recetteId chaîne doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

test("RED/GREEN E4 : POST /api/menus avec lignes[0].quantite chaîne (\"abc\") -> 400, rien créé", async () => {
  const unite = (await prisma.unite.findFirst()) ?? (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  const article = await creerArticleTarifeDeTest(`MENUS VALIDATION TEST E4 Article ${randomUUID()}`, unite, tva);
  const recetteId = await creerRecetteDeTest(`MENUS VALIDATION TEST E4 Recette ${randomUUID()}`, article.id, unite.id);

  const nom = `MENUS VALIDATION TEST E4 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [{ recetteId, quantite: "abc" }] });
  assert.equal(reponse.status, 400, "une quantite chaîne doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

test("RED/GREEN E5 : PUT /api/menus/:id avec lignes[0].recetteId chaîne (\"abc\") -> 400, menu intégralement inchangé", async () => {
  const nom = `MENUS VALIDATION TEST E5 ${randomUUID()}`;
  const creation = await poster("/api/menus", { nom, lignes: [] });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;
  const avant = await prisma.menu.findUniqueOrThrow({ where: { id: menuId }, include: { lignes: true } });

  const reponse = await mettreAJour(`/api/menus/${menuId}`, { nom, lignes: [{ recetteId: "abc", quantite: 1 }] });
  assert.equal(reponse.status, 400, "un recetteId chaîne doit être un refus 400, jamais un 500 ni un succès 200");
  const apres = await prisma.menu.findUniqueOrThrow({ where: { id: menuId }, include: { lignes: true } });
  assert.deepEqual(apres, avant, "le menu complet (y compris ses lignes) doit rester strictement identique après ce refus");
});

test("GREEN E6 : POST /api/menus avec recetteId = 2147483648 (hors bornes INT4) dans lignes -> 400, rien créé", async () => {
  const nom = `MENUS VALIDATION TEST E6 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [{ recetteId: 2147483648, quantite: 1 }] });
  assert.equal(reponse.status, 400, "un recetteId hors bornes INT4 doit être un refus 400, jamais un 500 ni un succès 201");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});

test("GREEN E7 : POST /api/menus sans la clé lignes -> accepté, menu sans ligne (comportement absent préservé)", async () => {
  const nom = `MENUS VALIDATION TEST E7 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom });
  assert.equal(reponse.status, 201);
  assert.equal(reponse.corps.lignes.length, 0);
});

test("GREEN E8 : POST /api/menus avec lignes = [] (tableau vide explicite) -> accepté, menu sans ligne", async () => {
  const nom = `MENUS VALIDATION TEST E8 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [] });
  assert.equal(reponse.status, 201);
  assert.equal(reponse.corps.lignes.length, 0);
});

test("GREEN E9 : régression — POST /api/menus avec lignes: null -> accepté, traité comme [] (comportement réel confirmé empiriquement sur la base non modifiée)", async () => {
  const nom = `MENUS VALIDATION TEST E9 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: null });
  assert.equal(reponse.status, 201, "lignes:null n'a jamais été refusé avant ce correctif : (lignes ?? []) le traite comme un tableau vide");
  assert.equal(reponse.corps.lignes.length, 0);
});

test("GREEN E10 : régression — PUT /api/menus/:id avec lignes: null sur un menu ayant des lignes existantes -> lignes vidées (remplacement intégral confirmé empiriquement sur la base non modifiée)", async () => {
  const unite = (await prisma.unite.findFirst()) ?? (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  const article = await creerArticleTarifeDeTest(`MENUS VALIDATION TEST E10 Article ${randomUUID()}`, unite, tva);
  const recetteId = await creerRecetteDeTest(`MENUS VALIDATION TEST E10 Recette ${randomUUID()}`, article.id, unite.id);

  const nom = `MENUS VALIDATION TEST E10 ${randomUUID()}`;
  const creation = await poster("/api/menus", { nom, lignes: [{ recetteId, quantite: 3 }] });
  assert.equal(creation.status, 201);
  assert.equal(creation.corps.lignes.length, 1);
  const menuId = creation.corps.id;

  const miseAJour = await mettreAJour(`/api/menus/${menuId}`, { nom, lignes: null });
  assert.equal(miseAJour.status, 200, "lignes:null n'a jamais été refusé avant ce correctif en PUT non plus");
  assert.equal(miseAJour.corps.lignes.length, 0, "lignes:null doit vider les lignes existantes, exactement comme lignes:[] (remplacement intégral)");
  const relu = await prisma.menu.findUniqueOrThrow({ where: { id: menuId }, include: { lignes: true } });
  assert.equal(relu.lignes.length, 0);
});

test("RED/GREEN E11 : POST /api/menus avec lignes[0].quantite explicitement null -> 400, aucun menu créé (distinct de quantite:0, qui ne crashait jamais)", async () => {
  const unite = (await prisma.unite.findFirst()) ?? (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  const article = await creerArticleTarifeDeTest(`MENUS VALIDATION TEST E11 Article ${randomUUID()}`, unite, tva);
  const recetteId = await creerRecetteDeTest(`MENUS VALIDATION TEST E11 Recette ${randomUUID()}`, article.id, unite.id);

  const nom = `MENUS VALIDATION TEST E11 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [{ recetteId, quantite: null }] });
  assert.equal(reponse.status, 400, "quantite explicitement null (distinct de 0 et de l'omission) crashait en 500 avant ce correctif (MenuLigne.quantite est un Float non nullable) ; doit désormais être un refus 400 propre");
  const menuCree = await prisma.menu.findFirst({ where: { nom, societeId } });
  assert.equal(menuCree, null, "aucun menu correspondant au nom unique et à la société du test ne doit exister après ce refus");
});

test("GREEN E12 : régression — POST /api/menus avec lignes[0].quantite = 0 (valeur numérique valide, distincte de null) -> accepté, jamais un refus", async () => {
  const unite = (await prisma.unite.findFirst()) ?? (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  const article = await creerArticleTarifeDeTest(`MENUS VALIDATION TEST E12 Article ${randomUUID()}`, unite, tva);
  const recetteId = await creerRecetteDeTest(`MENUS VALIDATION TEST E12 Recette ${randomUUID()}`, article.id, unite.id);

  const nom = `MENUS VALIDATION TEST E12 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [{ recetteId, quantite: 0 }] });
  assert.equal(reponse.status, 201, "quantite:0 est une valeur numérique valide, jamais crashée avant ce correctif : elle ne doit pas devenir un refus");
  assert.equal(reponse.corps.lignes[0].quantite, 0);
});

// --- F. id de l'URL malformé (PUT) ---

test("GREEN F1 : PUT /api/menus/abc (id non numérique) -> 400", async () => {
  const reponse = await mettreAJour("/api/menus/abc", { nom: "peu importe", lignes: [] });
  assert.equal(reponse.status, 400);
});

test("RED/GREEN F2 : PUT /api/menus/999999999999999999999 (id hors bornes) -> 400", async () => {
  const reponse = await mettreAJour("/api/menus/999999999999999999999", { nom: "peu importe", lignes: [] });
  assert.equal(reponse.status, 400, "un id d'URL hors bornes INT4 doit être un refus 400, jamais un 500");
});

test("GREEN F3 : PUT /api/menus/:id avec un id valide mais inexistant -> 404 (inchangé)", async () => {
  const reponse = await mettreAJour("/api/menus/999999999", { nom: "peu importe", lignes: [] });
  assert.equal(reponse.status, 404);
});

// --- G. menu d'une autre société ---

test("GREEN G1 : PUT sur un menu d'une autre société -> 404, jamais modifié", async () => {
  const autreSociete = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  const nomEtranger = `MENUS VALIDATION TEST G1 Etranger ${randomUUID()}`;
  const autreMenu = await prisma.menu.create({ data: { nom: nomEtranger, societeId: autreSociete.societeId } });
  try {
    const reponse = await mettreAJour(`/api/menus/${autreMenu.id}`, { nom: "tentative", lignes: [] });
    assert.equal(reponse.status, 404);
    const relu = await prisma.menu.findUniqueOrThrow({ where: { id: autreMenu.id } });
    assert.equal(relu.nom, nomEtranger, "le menu d'une autre société ne doit jamais être modifié");
  } finally {
    // Même raison et même ordre que C8 ci-dessus : Utilisateur référence Societe, pas de
    // cascade, aucun .catch(() => {}).
    await prisma.menu.delete({ where: { id: autreMenu.id } });
    await prisma.utilisateur.deleteMany({ where: { societeId: autreSociete.societeId } });
    await prisma.societe.delete({ where: { id: autreSociete.societeId } });
  }
});

// --- K. nom omis en PUT : conservé (PAS un remplacement intégral pour CE champ précis — confirmé
// empiriquement sur la base non modifiée : Prisma ignore une clé `undefined` dans `data`,
// contrairement à description/categorieId/prixVenteHT qui utilisent `?? null` et sont donc bien
// remis à null à l'omission). Ne pas présumer une symétrie entre tous les champs de PUT. ---

test("GREEN K1 : régression — PUT /api/menus/:id sans la clé nom -> nom conservé (comportement réel confirmé empiriquement, distinct de description/categorieId/prixVenteHT)", async () => {
  const nomInitial = `MENUS VALIDATION TEST K1 ${randomUUID()}`;
  const unite = (await prisma.unite.findFirst()) ?? (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  const article = await creerArticleTarifeDeTest(`MENUS VALIDATION TEST K1 Article ${randomUUID()}`, unite, tva);
  const recetteId = await creerRecetteDeTest(`MENUS VALIDATION TEST K1 Recette ${randomUUID()}`, article.id, unite.id);

  const creation = await poster("/api/menus", {
    nom: nomInitial,
    description: "desc initiale",
    prixVenteHT: 10,
    lignes: [{ recetteId, quantite: 2 }],
  });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;

  // nom absent du corps : doit être conservé, PAS refusé (schemaModificationMenu le rend
  // optionnel), PAS remis à une valeur vide — alors que description/prixVenteHT, eux, sont bien
  // remis à null puisqu'ils sont omis ici aussi (comportement normal de remplacement intégral,
  // inchangé pour ces champs).
  const miseAJour = await mettreAJour(`/api/menus/${menuId}`, { lignes: [{ recetteId, quantite: 5 }] });
  assert.equal(miseAJour.status, 200, "nom omis en PUT ne doit jamais être refusé");
  assert.equal(miseAJour.corps.nom, nomInitial, "nom doit rester exactement celui d'origine, jamais vidé ni modifié");
  assert.equal(miseAJour.corps.description, null, "description, elle, est bien remise à null quand omise (remplacement intégral normal pour ce champ)");

  const relu = await prisma.menu.findUniqueOrThrow({ where: { id: menuId } });
  assert.equal(relu.nom, nomInitial);
});

// --- H. calcul de coût échouant après écriture (fixture volontairement corrompue, PAS un défaut
// métier atteignable via l'API elle-même : rendement est borné ]0,1000] par Zod sur articles.ts) ---

test("RED/GREEN H1 : POST /api/menus référençant une recette dont l'article a un rendement corrompu (0, via Prisma direct) -> 500, aucun menu créé", async () => {
  const unite = (await prisma.unite.findFirst()) ?? (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  const article = await creerArticleTarifeDeTest(`MENUS VALIDATION TEST H1 Article ${randomUUID()}`, unite, tva);
  const recetteId = await creerRecetteDeTest(`MENUS VALIDATION TEST H1 Recette ${randomUUID()}`, article.id, unite.id);

  // Corruption directe, hors API : aucun chemin applicatif validé ne permet d'atteindre cet état
  // (rendement est borné ]0,1000] par Zod sur POST/PUT /articles, voir server/routes/articles.ts).
  await prisma.article.update({ where: { id: article.id }, data: { rendement: 0 } });

  const nom = `MENUS VALIDATION TEST H1 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, lignes: [{ recetteId, quantite: 1 }] });

  assert.equal(reponse.status, 500, "le calcul de coût doit échouer en interne (500), jamais un 201/400 qui éviterait de démontrer le rollback");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null, "si le calcul échoue après l'écriture, le menu ne doit JAMAIS rester committé");
});

test("RED/GREEN H2 : PUT /api/menus/:id — renommage ET remplacement d'une ligne valide par une recette corrompue -> 500, nom et ancienne ligne intégralement restaurés", async () => {
  const unite = (await prisma.unite.findFirst()) ?? (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));

  // Deux recettes distinctes : la première reste valide tout du long (c'est elle qui compose la
  // ligne initiale du menu, et qui doit être restaurée après le rollback) ; la seconde n'est
  // corrompue qu'APRÈS la création du menu, et n'est jamais utilisée que dans la tentative de PUT.
  const articleValide = await creerArticleTarifeDeTest(`MENUS VALIDATION TEST H2 Article valide ${randomUUID()}`, unite, tva);
  const recetteValideId = await creerRecetteDeTest(`MENUS VALIDATION TEST H2 Recette valide ${randomUUID()}`, articleValide.id, unite.id);
  const articleCorrompu = await creerArticleTarifeDeTest(`MENUS VALIDATION TEST H2 Article corrompu ${randomUUID()}`, unite, tva);
  const recetteCorrompueId = await creerRecetteDeTest(`MENUS VALIDATION TEST H2 Recette corrompue ${randomUUID()}`, articleCorrompu.id, unite.id);

  const nomInitial = `MENUS VALIDATION TEST H2 ${randomUUID()}`;
  const creation = await poster("/api/menus", { nom: nomInitial, lignes: [{ recetteId: recetteValideId, quantite: 2 }] });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;
  const avant = await prisma.menu.findUniqueOrThrow({
    where: { id: menuId },
    include: { lignes: { orderBy: [{ ordre: "asc" }, { id: "asc" }] } },
  });

  await prisma.article.update({ where: { id: articleCorrompu.id }, data: { rendement: 0 } });

  const nomTente = `MENUS VALIDATION TEST H2 RENOMME ${randomUUID()}`;
  const reponse = await mettreAJour(`/api/menus/${menuId}`, {
    nom: nomTente,
    lignes: [{ recetteId: recetteCorrompueId, quantite: 5 }],
  });

  assert.equal(reponse.status, 500, "le calcul de coût doit échouer en interne (500), jamais un 201/400/200 qui éviterait de démontrer le rollback");
  const apres = await prisma.menu.findUniqueOrThrow({
    where: { id: menuId },
    include: { lignes: { orderBy: [{ ordre: "asc" }, { id: "asc" }] } },
  });
  assert.deepEqual(
    apres,
    avant,
    "rollback complet attendu : le nom doit rester celui d'origine (jamais nomTente) ET l'ancienne ligne (recette valide, quantite 2) doit être restaurée à l'identique — la tentative de remplacement par la recette corrompue ne doit laisser aucune trace"
  );
});

// --- I. régression : créations/modifications valides inchangées ---

// Fixture déterministe pour les assertions de coût ci-dessous : unite et tva TOUJOURS créées
// fraîches (jamais findFirst() ?? create(), qui pourrait silencieusement récupérer une unite
// partagée d'un autre fichier de test avec un facteurBase différent de 1000, rendant le calcul
// imprévisible) — nom unique par randomUUID(), sans risque de collision (aucune contrainte
// @@unique sur Unite.nom ni TVA.nom, voir prisma/schema.prisma).
//
// Dérivation du coût attendu, à partir des seuls paramètres fixés ci-dessous et dans
// creerArticleTarifeDeTest/creerRecetteDeTest (voir server/utils/coutRecette.ts) :
//   prixUnitaireBase = prixHT(10) / (quantiteConditionnement(1) * facteurBase(1000)) = 0.01
//   quantiteBaseRecette = quantite ligne recette(1) * facteurBase(1000) = 1000
//   coutLigneRecette = quantiteBaseRecette * prixUnitaireBase / (rendement(100)/100) = 10
//   coutParPortionRecette = coutLigneRecette / portions recette(1) = 10
// D'où, pour une ligne de menu de quantite Q : coutTotal menu = 10 * Q.
const COUT_PAR_PORTION_RECETTE_DETERMINISTE = 10;

async function creerUniteDeterministeDeTest() {
  return prisma.unite.create({
    data: { nom: `Unite coût déterministe ${randomUUID()}`, symbole: "kg", type: "poids", facteurBase: 1000 },
  });
}

async function creerTvaDeterministeDeTest() {
  return prisma.tVA.create({ data: { nom: `TVA coût déterministe ${randomUUID()}`, taux: 5.5 } });
}

test("GREEN I1 : régression — POST /api/menus valide avec recette -> coût et food cost exacts, pas seulement « un nombre »", async () => {
  const unite = await creerUniteDeterministeDeTest();
  const tva = await creerTvaDeterministeDeTest();
  const article = await creerArticleTarifeDeTest(`MENUS VALIDATION TEST I1 Article ${randomUUID()}`, unite, tva);
  const recetteId = await creerRecetteDeTest(`MENUS VALIDATION TEST I1 Recette ${randomUUID()}`, article.id, unite.id);

  const quantiteLigneMenu = 2;
  const prixVenteHT = 20;
  const coutTotalAttendu = COUT_PAR_PORTION_RECETTE_DETERMINISTE * quantiteLigneMenu; // 20
  const foodCostPctAttendu = (coutTotalAttendu / prixVenteHT) * 100; // 100
  const margeHTAttendue = prixVenteHT - coutTotalAttendu; // 0

  const nom = `MENUS VALIDATION TEST I1 ${randomUUID()}`;
  const reponse = await poster("/api/menus", { nom, categorieId, prixVenteHT, lignes: [{ recetteId, quantite: quantiteLigneMenu }] });
  assert.equal(reponse.status, 201);
  assert.equal(reponse.corps.lignes.length, 1);
  assert.equal(reponse.corps.lignes[0].recette.id, recetteId);
  assert.equal(reponse.corps.coutTotal, coutTotalAttendu, "coût attendu calculé à partir de la fixture déterministe, pas seulement vérifié comme étant un nombre");
  assert.equal(reponse.corps.foodCostPct, foodCostPctAttendu);
  assert.equal(reponse.corps.margeHT, margeHTAttendue);
});

test("GREEN I2 : régression — PUT /api/menus/:id valide (changement de prix/lignes) -> coût et food cost exacts après mise à jour", async () => {
  const unite = await creerUniteDeterministeDeTest();
  const tva = await creerTvaDeterministeDeTest();
  const article = await creerArticleTarifeDeTest(`MENUS VALIDATION TEST I2 Article ${randomUUID()}`, unite, tva);
  const recetteId = await creerRecetteDeTest(`MENUS VALIDATION TEST I2 Recette ${randomUUID()}`, article.id, unite.id);

  const nom = `MENUS VALIDATION TEST I2 ${randomUUID()}`;
  const creation = await poster("/api/menus", { nom, lignes: [] });
  assert.equal(creation.status, 201);
  const menuId = creation.corps.id;

  const quantiteLigneMenu = 3;
  const prixVenteHT = 30;
  const coutTotalAttendu = COUT_PAR_PORTION_RECETTE_DETERMINISTE * quantiteLigneMenu; // 30
  const foodCostPctAttendu = (coutTotalAttendu / prixVenteHT) * 100; // 100
  const margeHTAttendue = prixVenteHT - coutTotalAttendu; // 0

  const miseAJour = await mettreAJour(`/api/menus/${menuId}`, { nom, prixVenteHT, lignes: [{ recetteId, quantite: quantiteLigneMenu }] });
  assert.equal(miseAJour.status, 200);
  assert.equal(miseAJour.corps.lignes.length, 1);
  assert.equal(miseAJour.corps.prixVenteHT, prixVenteHT);
  assert.equal(miseAJour.corps.coutTotal, coutTotalAttendu, "coût attendu après PUT, calculé à partir de la fixture déterministe");
  assert.equal(miseAJour.corps.foodCostPct, foodCostPctAttendu);
  assert.equal(miseAJour.corps.margeHT, margeHTAttendue);
});

// --- J. panne interne simulée (fault injection) : ne doit jamais être maquillée en 400 ---

test("GREEN J1 : une panne interne simulée sur POST /api/menus reste une erreur serveur (500), jamais maquillée en 400", async () => {
  const nom = `MENUS VALIDATION TEST J1 ${randomUUID()}`;

  // calculerCoutMenu est désormais appelé DANS prisma.$transaction (voir le correctif) : la panne
  // doit donc être injectée sur le tx réel transmis par Prisma, pas sur prisma.menu.create
  // directement (qui n'est plus la méthode effectivement appelée par le routeur).
  const originalTransaction = prisma.$transaction.bind(prisma);
  (prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = (async (
    arg: unknown,
    ...reste: unknown[]
  ) => {
    if (typeof arg !== "function") {
      return (originalTransaction as (...a: unknown[]) => unknown)(arg, ...reste);
    }
    return (originalTransaction as (...a: unknown[]) => unknown)(async (tx: unknown) => {
      const txMenu = (tx as { menu: { create: (...args: unknown[]) => Promise<unknown> } }).menu;
      txMenu.create = async () => {
        throw new Error("PANNE SIMULÉE (test menus) : échec déterministe confiné aux tests, jamais une panne réelle");
      };
      return (arg as (tx: unknown) => unknown)(tx);
    }, ...reste);
  }) as typeof prisma.$transaction;

  let statut: number;
  try {
    const reponse = await poster("/api/menus", { nom, lignes: [] });
    statut = reponse.status;
  } finally {
    (prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = originalTransaction;
  }

  assert.equal(statut, 500, "une panne interne réelle ne doit jamais être maquillée en 400");
  const menuCree = await prisma.menu.findFirst({ where: { nom } });
  assert.equal(menuCree, null);
});
