import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Traçabilité HACCP datée (Phase 2 du plan d'action) : jusqu'ici un point critique HACCP n'avait
// qu'une procédure fixe décrite sur la recette, jamais de contrôle réellement daté sur un lot
// produit — voir server/routes/productions.ts. Ce parcours exerce le chemin complet réellement
// disponible dans l'interface : Production → planification → "Enregistrer la production" → page
// Traçabilité HACCP → enregistrement des contrôles datés pour chaque point critique, avec
// vérification finale directement en base.

let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteKgId: number;
let depotId: number;
let articleId: number;
let recetteId: number;
let etapeCuissonId: number;
let etapeLegumesId: number;
let productionId: number;

test.beforeAll(async () => {
  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;

  const depot = await prisma.depot.create({ data: { nom: "E2E HACCP Dépôt", societeId } });
  depotId = depot.id;

  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E HACCP Article", categorieId, tvaId, societeId, rendement: 100, actif: true },
  });
  articleId = article.id;

  const recette = await prisma.recette.create({
    data: {
      nom: "E2E HACCP Recette",
      portions: 4,
      societeId,
      categorieId,
      lignes: { create: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }] },
      etapes: {
        create: [
          { ordre: 1, description: "Cuire à 220°C au four", pointCritiqueHACCP: false, controleHACCP: null },
          { ordre: 2, description: "Découper les légumes", pointCritiqueHACCP: true, controleHACCP: "Vérifier la propreté du matériel" },
          { ordre: 3, description: "Dresser l'assiette", pointCritiqueHACCP: false, controleHACCP: null },
        ],
      },
    },
    include: { etapes: true },
  });
  recetteId = recette.id;
  etapeCuissonId = recette.etapes.find((e) => e.description.includes("Cuire"))!.id;
  etapeLegumesId = recette.etapes.find((e) => e.description.includes("légumes"))!.id;
});

test.afterAll(async () => {
  if (productionId) {
    await prisma.controleHACCPProduction.deleteMany({ where: { productionId } });
    await prisma.production.deleteMany({ where: { id: productionId } });
  }
  await prisma.recetteLigne.deleteMany({ where: { recetteId } });
  await prisma.recetteEtape.deleteMany({ where: { recetteId } });
  await prisma.recette.delete({ where: { id: recetteId } });
  await prisma.article.delete({ where: { id: articleId } });
  await prisma.depot.delete({ where: { id: depotId } });
});

test("traçabilité HACCP datée : Production -> production enregistrée -> contrôles datés -> résumé complet", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto(`/production/${recetteId}`);
  await expect(page.getByRole("heading", { name: /E2E HACCP Recette/ })).toBeVisible();

  await page.getByRole("combobox").selectOption({ label: "E2E HACCP Dépôt" });
  const champCible = page.locator('input[inputmode="decimal"]');
  await champCible.fill("40");
  await page.getByRole("button", { name: "Planifier" }).click();
  await expect(page.getByText("E2E HACCP Article")).toBeVisible();

  await page.getByRole("button", { name: "Enregistrer la production" }).click();
  const lienProduction = page.getByRole("link", { name: "enregistrer les contrôles HACCP" });
  await expect(lienProduction).toBeVisible();
  const href = await lienProduction.getAttribute("href");
  productionId = Number(href?.split("/").pop());
  expect(productionId).toBeGreaterThan(0);

  await lienProduction.click();
  await expect(page).toHaveURL(new RegExp(`/productions/${productionId}$`));
  await expect(page.getByRole("heading", { name: "E2E HACCP Recette" })).toBeVisible({ timeout: 20_000 });

  // Les 2 points critiques (cuisson détectée par mots-clés + légumes déclaré manuellement)
  // apparaissent, jamais "Dresser l'assiette" (ni détecté ni déclaré).
  await expect(page.getByRole("heading", { name: "⚠ Cuire à 220°C au four" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "⚠ Découper les légumes" })).toBeVisible();
  await expect(page.getByText("Dresser l'assiette")).toHaveCount(0);

  const cadreCuisson = page.locator("div", { has: page.getByRole("heading", { name: "⚠ Cuire à 220°C au four" }) }).last();
  await cadreCuisson.getByPlaceholder("Valeur constatée (ex. 72°C)").fill("218°C à cœur");
  await cadreCuisson.getByRole("button", { name: "Enregistrer le contrôle" }).click();
  await expect(cadreCuisson.getByText("218°C à cœur")).toBeVisible();
  await expect(cadreCuisson.getByText("✓ Conforme")).toBeVisible();

  // "Découper les légumes" déclenche aussi la règle LEGUMES_CRUS par mot-clé ("légumes") : une
  // suggestion rapide pré-remplit le champ et coche/décoche "Conforme" en un clic, plutôt que de
  // tout taper (voir suggestionsControleHACCP.ts).
  const cadreLegumes = page.locator("div", { has: page.getByRole("heading", { name: "⚠ Découper les légumes" }) }).last();
  await cadreLegumes.getByRole("button", { name: /Légumes triés, lavés et désinfectés selon le protocole/ }).click();
  await expect(cadreLegumes.getByPlaceholder("Valeur constatée (ex. 72°C)")).toHaveValue(
    "Légumes triés, lavés et désinfectés selon le protocole"
  );
  await cadreLegumes.getByRole("button", { name: "Enregistrer le contrôle" }).click();
  await expect(cadreLegumes.getByText("Légumes triés, lavés et désinfectés selon le protocole")).toBeVisible();
  await expect(cadreLegumes.getByText("✓ Conforme")).toBeVisible();

  await page.goto("/productions");
  await expect(page.getByRole("heading", { name: "📋 Traçabilité HACCP" })).toBeVisible();
  const ligne = page.locator("tr", { hasText: "E2E HACCP Recette" });
  await expect(ligne).toContainText("2/2 contrôlé(s)");

  const controles = await prisma.controleHACCPProduction.findMany({ where: { productionId }, orderBy: { recetteEtapeId: "asc" } });
  expect(controles.length).toBe(2);
  expect(controles.some((c) => c.recetteEtapeId === etapeCuissonId && c.valeur === "218°C à cœur")).toBe(true);
  expect(controles.some((c) => c.recetteEtapeId === etapeLegumesId)).toBe(true);
});
