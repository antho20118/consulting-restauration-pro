import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Audit mobile complet (au-delà de la barre latérale, déjà couverte par
// menuMobileResponsive.spec.ts) : deux familles de débordement horizontal repérées sur des
// captures d'écran mobiles réelles.
// 1. Formulaires en popup à largeur fixe (ex. IngredientForm.tsx, width: 450) dont le fond
//    (position: fixed, inset: 0, padding horizontal nul) ne limitait pas leur largeur — sur un
//    viewport étroit, la carte débordait sans qu'aucun défilement ne soit proposé, rendant le
//    formulaire partiellement inatteignable. Corrigé par maxWidth: calc(100vw - 32px) +
//    boxSizing: border-box sur chaque popup concernée. Ce test vérifie qu'une telle popup ne
//    déborde plus et que son bouton d'action, potentiellement le plus à droite, reste atteignable.
// 2. Tableaux <table> sans wrapper de défilement (ex. HaccpPage.tsx) : corrigé en les enveloppant
//    dans <div style={{ overflowX: "auto" }}>, comme déjà pratiqué ailleurs (FournisseurDetailPage,
//    TarifsGroupeFournisseurs).
// Un toolbar de page sans flexWrap (ex. IngredientsPage.tsx : boutons + champ de recherche à
// largeur fixe) pouvait aussi provoquer un débordement horizontal sur mobile ; corrigé par
// flexWrap: "wrap" + gap, déjà en place sur FournisseursPage.tsx.

test.use({ viewport: { width: 390, height: 844 } });

test.beforeAll(async () => {
  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }
});

async function debordementHorizontal(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function ouvrirPageDepuisMenuMobile(page: import("@playwright/test").Page, lien: string) {
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("link", { name: lien }).click();
}

test("mobile (390px) : la page Ingrédients (toolbar + popup formulaire) et la page HACCP (tableaux) ne débordent jamais horizontalement", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  // Page Ingrédients : toolbar (boutons + champ de recherche à largeur fixe) sans flexWrap
  // provoquait un débordement — vérifié avant toute autre interaction.
  await ouvrirPageDepuisMenuMobile(page, "🥕 Base ingrédients");
  await expect(page).toHaveURL(/\/ingredients$/);
  await expect(page.getByRole("button", { name: "+ Nouvel ingrédient" })).toBeVisible({ timeout: 20_000 });
  expect(await debordementHorizontal(page)).toBeLessThanOrEqual(1);

  // Popup IngredientForm (largeur fixe 450px) : ne doit plus déborder, et son bouton
  // "Enregistrer" (le plus à droite du formulaire) doit rester entièrement dans le viewport.
  await page.getByRole("button", { name: "+ Nouvel ingrédient" }).click();
  const boutonEnregistrer = page.getByRole("button", { name: "Enregistrer" });
  await expect(boutonEnregistrer).toBeVisible();
  expect(await debordementHorizontal(page)).toBeLessThanOrEqual(1);

  const boiteBouton = await boutonEnregistrer.boundingBox();
  expect(boiteBouton).not.toBeNull();
  expect(boiteBouton!.x + boiteBouton!.width).toBeLessThanOrEqual(390 + 1);

  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(boutonEnregistrer).toBeHidden();

  // Page HACCP : les tableaux (risque, mesure préventive…) sont maintenant enveloppés dans un
  // conteneur à défilement horizontal propre, sans faire déborder la page elle-même.
  await ouvrirPageDepuisMenuMobile(page, "🛡️ HACCP");
  await expect(page).toHaveURL(/\/haccp$/);
  await expect(page.getByRole("heading", { name: "⚠ Cuisson" })).toBeVisible({ timeout: 20_000 });
  expect(await debordementHorizontal(page)).toBeLessThanOrEqual(1);
});
