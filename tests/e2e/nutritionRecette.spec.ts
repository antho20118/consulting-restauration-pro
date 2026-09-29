import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Information nutritionnelle (second volet de la Phase 2, voir server/utils/coutRecette.ts) :
// jusqu'ici le modèle ValeurNutritionnelle n'était câblé qu'en lecture (GET /articles), jamais
// saisissable depuis l'interface ni affiché sur une fiche recette. Ce parcours exerce le chemin
// complet réellement disponible : Base ingrédients → modification d'un ingrédient → saisie des
// valeurs nutritionnelles (pour 100g) → Fiches recettes → ouverture de la fiche → vérification de
// l'agrégation par portion.

let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteKgId: number;
let articleId: number;
let recetteId: number;

test.beforeAll(async () => {
  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }
  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;

  // Aucune valeur nutritionnelle à la création : c'est précisément la saisie via IngredientForm,
  // plus loin dans le test, qui doit la créer.
  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E Nutrition Article", categorieId, tvaId, societeId, rendement: 100, actif: true },
  });
  articleId = article.id;

  // 1 kg (facteurBase 1000) par portion-recette, 2 portions : quantiteBase = 1000g, jamais divisée
  // par le rendement (voir calculerCoutRecette) — permet de vérifier l'agrégation par simple
  // multiplication/division sans dépendre du rendement.
  const recette = await prisma.recette.create({
    data: {
      nom: "E2E Nutrition Recette",
      portions: 2,
      societeId,
      categorieId,
      lignes: { create: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }] },
    },
  });
  recetteId = recette.id;
});

test.afterAll(async () => {
  // La modification de l'ingrédient via IngredientForm envoie toujours stockInitial (0 par défaut,
  // voir IngredientForm.tsx) : PUT /articles/:id upserte donc systématiquement un Stock pour le
  // premier dépôt de la société, qu'on n'a jamais demandé explicitement ici — à nettoyer comme le
  // reste avant de pouvoir supprimer l'article (FK Stock_articleId_fkey).
  await prisma.stock.deleteMany({ where: { articleId } });
  await prisma.valeurNutritionnelle.deleteMany({ where: { articleId } });
  await prisma.recetteLigne.deleteMany({ where: { recetteId } });
  await prisma.recette.delete({ where: { id: recetteId } });
  await prisma.article.delete({ where: { id: articleId } });
});

test("information nutritionnelle : saisie sur un ingrédient -> agrégation affichée sur la fiche recette", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto("/ingredients");
  await expect(page.getByRole("heading", { name: "🥕 Base ingrédients" })).toBeVisible();

  const ligneArticle = page.locator(".MuiDataGrid-row", { hasText: "E2E Nutrition Article" });
  await expect(ligneArticle).toBeVisible({ timeout: 15_000 });
  await ligneArticle.getByRole("button", { name: "Modifier" }).click();

  await expect(page.getByText("Valeurs nutritionnelles (pour 100 g)")).toBeVisible();
  // Valeurs "pour 100g" choisies pour que l'agrégation (1000g de base, 2 portions, jamais divisée
  // par le rendement) tombe sur des nombres ronds une fois affichés par portion.
  await page.locator("#nutrition-energie").fill("60");
  await page.locator("#nutrition-proteines").fill("10");
  await page.locator("#nutrition-glucides").fill("8");
  await page.locator("#nutrition-sucres").fill("4");
  await page.locator("#nutrition-lipides").fill("6");
  await page.locator("#nutrition-acidesGrasSatures").fill("2");
  await page.locator("#nutrition-fibres").fill("3");
  await page.locator("#nutrition-sel").fill("1");

  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Valeurs nutritionnelles (pour 100 g)")).toBeHidden();

  const enBase = await prisma.valeurNutritionnelle.findUnique({ where: { articleId } });
  expect(enBase?.energie).toBe(60);
  expect(enBase?.sel).toBe(1);

  await page.goto("/recettes");
  await page.getByRole("button", { name: "E2E Nutrition Recette" }).click();
  await expect(page.getByRole("heading", { name: "Valeurs nutritionnelles (par portion)" })).toBeVisible();

  // 1000g × valeur/100g / 2 portions, jamais divisé par le rendement (100 % ici, donc pas
  // discriminant seul — voir la vérification équivalente côté unitaire dans coutRecette.test.ts).
  // exact: true pour ne cibler que le <strong> ("300 kcal"), jamais le <span> englobant
  // ("Énergie : 300 kcal") qui contient aussi cette sous-chaîne.
  await expect(page.getByText("300 kcal", { exact: true })).toBeVisible();
  await expect(page.getByText("50.0 g", { exact: true })).toBeVisible();
  await expect(page.getByText("40.0 g", { exact: true })).toBeVisible();
  await expect(page.getByText("20.0 g", { exact: true })).toBeVisible();
  await expect(page.getByText("30.0 g", { exact: true })).toBeVisible();
  await expect(page.getByText("10.0 g", { exact: true })).toBeVisible();
  await expect(page.getByText("15.0 g", { exact: true })).toBeVisible();
  await expect(page.getByText("5.00 g", { exact: true })).toBeVisible();
  await expect(page.getByText(/Approximation/)).toHaveCount(0);
});
