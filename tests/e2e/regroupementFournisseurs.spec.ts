import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Chantier « refonte liste fournisseurs » + « regroupement des tarifs homonymes » — parcours
// navigateur réel : deux fournisseurs physiques partageant le même nom (après trim, casse-
// insensible — règle validée) doivent apparaître comme une seule carte dans la liste, dont le clic
// ouvre une vue groupée (jamais une fusion en base) avec :
//   - niveau 2 : les enregistrements physiques distincts, chacun menant à SA fiche existante
//     (/fournisseurs/:id, inchangée) ;
//   - niveau 3 : la totalité des tarifs du groupe, chaque ligne portant son fournisseur d'origine —
//     y compris pour un même article vendu par les deux fournisseurs à des prix différents (repris
//     du cadrage : Poulet chez A à 6,20 €, chez B à 5,95 €), sans jamais fusionner ni écraser l'un
//     par l'autre.

let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteId: number;
let conditionnementId: number;
let fournisseurAId: number;
let fournisseurBId: number;
let articlePouletId: number;
let articleCremeId: number;
let articleBeurreId: number;

const NOM_PARTAGE = "E2E HOMONYME Regroupement Test";

test.beforeAll(async () => {
  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteId = uniteKg.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Sac" } }));
  conditionnementId = conditionnement.id;

  // Deux enregistrements physiques distincts, même nom après trim/casse (l'un avec des espaces,
  // l'autre en majuscules) : vérifie que la règle de regroupement validée s'applique bien de bout
  // en bout dans l'app réelle, pas seulement dans l'utilitaire testé isolément.
  const fournisseurA = await prisma.fournisseur.create({
    data: { nom: `  ${NOM_PARTAGE}  `, telephone: "0611111111", societeId },
  });
  fournisseurAId = fournisseurA.id;
  const fournisseurB = await prisma.fournisseur.create({
    data: { nom: NOM_PARTAGE.toUpperCase(), telephone: "0622222222", societeId },
  });
  fournisseurBId = fournisseurB.id;

  const articlePoulet = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E HOMONYME Poulet", categorieId, tvaId, societeId },
  });
  articlePouletId = articlePoulet.id;
  const articleCreme = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E HOMONYME Creme", categorieId, tvaId, societeId },
  });
  articleCremeId = articleCreme.id;
  const articleBeurre = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E HOMONYME Beurre", categorieId, tvaId, societeId },
  });
  articleBeurreId = articleBeurre.id;

  // Fournisseur A : Poulet à 6,20 €, Crème à 4,80 €.
  await prisma.tarifArticle.create({
    data: { articleId: articlePouletId, fournisseurId: fournisseurAId, uniteId, conditionnementId, quantiteConditionnement: 1, prixHT: 6.2 },
  });
  await prisma.tarifArticle.create({
    data: { articleId: articleCremeId, fournisseurId: fournisseurAId, uniteId, conditionnementId, quantiteConditionnement: 1, prixHT: 4.8 },
  });
  // Fournisseur B : Poulet à 5,95 € (même article que A, prix différent), Beurre à 7,20 €.
  await prisma.tarifArticle.create({
    data: { articleId: articlePouletId, fournisseurId: fournisseurBId, uniteId, conditionnementId, quantiteConditionnement: 1, prixHT: 5.95 },
  });
  await prisma.tarifArticle.create({
    data: { articleId: articleBeurreId, fournisseurId: fournisseurBId, uniteId, conditionnementId, quantiteConditionnement: 1, prixHT: 7.2 },
  });
});

test.afterAll(async () => {
  const articleIds = [articlePouletId, articleCremeId, articleBeurreId];
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.fournisseur.deleteMany({ where: { id: { in: [fournisseurAId, fournisseurBId] } } });
});

test("regroupement homonymes : une carte, sélecteur, tarifs groupés non fusionnés, fiche individuelle isolée, 4 onglets", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto("/fournisseurs");

  // B. Une seule carte pour les deux enregistrements homonymes (pas deux lignes dupliquées).
  await expect(page.getByText(NOM_PARTAGE, { exact: false })).toHaveCount(1);
  await expect(page.getByText("2 fournisseurs")).toBeVisible();
  // Total agrégé : 4 tarifs (2 chez A, 2 chez B).
  await expect(page.getByText("4 tarif(s)")).toBeVisible();

  await page.getByText(NOM_PARTAGE, { exact: false }).click();

  // C. Le sélecteur liste bien les DEUX enregistrements physiques distincts avec leurs coordonnées
  // propres — jamais un choix arbitraire de « le » fournisseur.
  await expect(page.getByRole("heading", { name: /Plusieurs fournisseurs/ })).toBeVisible();
  await expect(page.getByText("Téléphone : 0611111111")).toBeVisible();
  await expect(page.getByText("Téléphone : 0622222222")).toBeVisible();

  // D/E/F/G. Vue groupée des tarifs (niveau 3) : les 4 tarifs sont tous présents, y compris les
  // DEUX tarifs "Poulet" distincts (6,20 € chez A, 5,95 € chez B) — jamais fusionnés ni écrasés — et
  // chaque ligne identifie son fournisseur d'origine via son téléphone.
  const tableauGroupe = page.locator("table").filter({ hasText: "E2E HOMONYME Poulet" });
  await expect(tableauGroupe.getByRole("row", { name: /E2E HOMONYME Poulet.*0611111111.*6\.2000/ })).toBeVisible();
  await expect(tableauGroupe.getByRole("row", { name: /E2E HOMONYME Poulet.*0622222222.*5\.9500/ })).toBeVisible();
  await expect(tableauGroupe.getByRole("row", { name: /E2E HOMONYME Creme.*0611111111.*4\.8000/ })).toBeVisible();
  await expect(tableauGroupe.getByRole("row", { name: /E2E HOMONYME Beurre.*0622222222.*7\.2000/ })).toBeVisible();
  // Exactement 4 lignes de données (+ 1 ligne d'en-tête) : aucun doublon artificiel, aucune perte.
  await expect(tableauGroupe.locator("tbody tr")).toHaveCount(4);

  const ligneB = page.locator("li", { hasText: "0622222222" });
  await ligneB.getByRole("button", { name: "Fiche" }).click();

  // Ouvre la fiche EXISTANTE (inchangée) du fournisseur B précisément — jamais A.
  await expect(page).toHaveURL(new RegExp(`/fournisseurs/${fournisseurBId}$`));
  await expect(page.getByText("Téléphone : 0622222222")).toBeVisible();

  // I. La fiche individuelle de B ne montre QUE ses propres tarifs : son Poulet à 5,95 € et son
  // Beurre — jamais le Poulet de A (6,20 €) ni sa Crème (article exclusif à A).
  await page.getByRole("button", { name: "Articles / Tarifs" }).click();
  await expect(page.getByText("E2E HOMONYME Beurre")).toBeVisible();
  await expect(page.getByText("5.9500 €")).toBeVisible();
  await expect(page.getByText("6.2000 €")).not.toBeVisible();
  await expect(page.getByText("E2E HOMONYME Creme")).not.toBeVisible();

  // J. Les 4 onglets existants restent fonctionnels (non-régression).
  await page.getByRole("button", { name: "Listings" }).click();
  await expect(page.getByText("Aucun listing importé pour l'instant.")).toBeVisible();
  await page.getByRole("button", { name: "Factures" }).click();
  await expect(page.getByText(/Aucune facture importée pour l'instant/)).toBeVisible();
  await page.getByRole("button", { name: "Informations" }).click();
  await expect(page.getByText("Téléphone : 0622222222")).toBeVisible();
});
