import { test, expect, type Page } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Prévisualisation d'un import de recette (PrevisualisationImportRecette.tsx), retours d'un test
// réel sur staging :
// 1. Choisir soi-même un article dans la prévisualisation ne comptait pas comme une confirmation :
//    le formulaire affichait ensuite le bandeau « Article rapproché automatiquement… à confirmer »
//    et, sans second choix, la correspondance n'était jamais mémorisée pour les imports suivants.
// 2. Sur téléphone, le champ « Rechercher un article » de la prévisualisation était écrasé à
//    quelques pixels de large (racine flex: 2 sans largeur minimale, dans une ligne qui passe à
//    la ligne) : inutilisable.
//
// Mode « Coller du texte » sans clé IA (analyse locale), comme sur l'application de staging.

const PREFIXE = "E2E PREVISU";
const NOM_RECETTE = `${PREFIXE} Tarte`;
const INGREDIENT = "zorglubine";
const TEXTE_RECETTE = `${NOM_RECETTE}\n\n100g de ${INGREDIENT}\n`;

test.describe.configure({ mode: "serial" });

let articleId: number;
let fournisseurId: number;

test.beforeAll(async () => {
  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  const categorie =
    (await prisma.categorie.findFirst({ where: { societeId: societe.id }, orderBy: { id: "asc" } })) ??
    (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId: societe.id } }));
  const tva =
    (await prisma.tVA.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  const uniteGramme =
    (await prisma.unite.findFirst({ where: { symbole: "g" } })) ??
    (await prisma.unite.create({ data: { nom: "Gramme", symbole: "g", type: "poids", facteurBase: 1 } }));
  const conditionnement =
    (await prisma.conditionnement.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.conditionnement.create({ data: { nom: "Unité" } }));

  // Un fournisseur qui n'est pas Super U : c'est le cas du test réel (le filtre Super U est
  // désactivé dans chaque test via sa préférence, comme dans importPhotoNormalisation.spec.ts).
  const fournisseur = await prisma.fournisseur.create({
    data: { nom: `${PREFIXE} Fournisseur`, societeId: societe.id },
  });
  fournisseurId = fournisseur.id;
  // Nom volontairement différent de l'ingrédient importé : aucun rapprochement automatique, c'est
  // l'utilisateur qui choisit l'article dans la prévisualisation.
  const article = await prisma.article.create({
    data: {
      nom: `${PREFIXE} poudre spéciale`,
      reference: "E2EPREVISU-001",
      categorieId: categorie.id,
      tvaId: tva.id,
      societeId: societe.id,
      rendement: 100,
      type: "MATIERE_PREMIERE",
    },
  });
  articleId = article.id;
  await prisma.tarifArticle.create({
    data: {
      articleId,
      fournisseurId,
      uniteId: uniteGramme.id,
      conditionnementId: conditionnement.id,
      quantiteConditionnement: 1000,
      prixHT: 3,
      actif: true,
    },
  });
  await prisma.aliasIngredientImport.deleteMany({ where: { texteNormalise: INGREDIENT } });
});

test.afterAll(async () => {
  await prisma.recette.deleteMany({ where: { nom: NOM_RECETTE } });
  await prisma.aliasIngredientImport.deleteMany({ where: { texteNormalise: INGREDIENT } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.deleteMany({ where: { id: articleId } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
});

async function ouvrirPrevisualisation(page: Page, filtreSuperU: "oui" | "non" = "non") {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });
  await page.evaluate((valeur) => localStorage.setItem("consulting_filtre_super_u", valeur), filtreSuperU);
  await page.goto("/recettes");

  await page.getByRole("button", { name: "Importer une recette", exact: true }).click();
  await page.getByRole("button", { name: "Coller du texte" }).click();
  await page.locator("textarea").fill(TEXTE_RECETTE);
  await page.locator('button:has-text("Analyser")').click();
  await expect(page.locator("text=Prévisualisation de l'import")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`text=Nom extrait : ${INGREDIENT}`)).toBeVisible();
}

test("prévisualisation : un article choisi par l'utilisateur vaut confirmation et est mémorisé", async ({ page }) => {
  await ouvrirPrevisualisation(page);
  await expect(page.locator("text=Aucun article correspondant trouvé")).toBeVisible();

  const champ = page.getByPlaceholder("Rechercher un article (nom ou code)…");
  await expect(champ).toHaveCount(1);
  await champ.fill("E2EPREVISU");
  await page.locator("div", { hasText: new RegExp(`^${PREFIXE} poudre spéciale \\(code E2EPREVISU-001\\)$`) }).last().click();
  await expect(page.locator(`text=Article choisi : ${PREFIXE} poudre spéciale`)).toBeVisible();

  await page.locator('button:has-text("Créer la recette à partir de cet import")').click();
  await expect(page.locator('button:has-text("Enregistrer")')).toBeVisible({ timeout: 10_000 });
  // Choix explicite déjà fait : le formulaire ne le redemande pas.
  await expect(page.getByText(/Article rapproché automatiquement à l'import/)).toHaveCount(0);

  await page.locator('button:has-text("Enregistrer")').click();
  await expect(page.locator('button:has-text("Enregistrer")')).toHaveCount(0, { timeout: 10_000 });

  await expect
    .poll(async () => (await prisma.aliasIngredientImport.findUnique({ where: { texteNormalise: INGREDIENT } }))?.articleId)
    .toBe(articleId);
});

// Suite du test précédent (mode serial) : la correspondance « zorglubine » y a été mémorisée vers
// un article dont le fournisseur n'est pas Super U. Avec le filtre « Super U uniquement » actif (sa
// valeur par défaut), elle était ignorée au prochain import : l'article mémorisé n'était cherché
// que parmi les articles Super U.
test("filtre Super U actif : une correspondance mémorisée vers un autre fournisseur est retrouvée", async ({ page }) => {
  await ouvrirPrevisualisation(page, "oui");
  await expect(page.locator(`text=Article proposé : ${PREFIXE} poudre spéciale — à confirmer`)).toBeVisible();
});

test.describe("téléphone (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("prévisualisation : le champ de recherche d'article garde une largeur utilisable", async ({ page }) => {
    await ouvrirPrevisualisation(page);
    const boite = await page.getByPlaceholder("Rechercher un article (nom ou code)…").boundingBox();
    expect(boite, "le champ de recherche doit être affiché").not.toBeNull();
    expect(boite!.width, `largeur du champ : ${boite!.width}px`).toBeGreaterThanOrEqual(150);
  });
});
