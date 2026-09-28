import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Audit backend→interface (priorité 3) : GET /haccp/regles renvoyait déjà la bibliothèque
// complète de règles HACCP (risque, mesure préventive, limite critique, surveillance, action
// corrective, mots-clés de détection) mais n'était jamais appelée par le frontend — seuls les
// noms des règles détectées sur une étape précise étaient visibles (voir RecetteDetail.tsx). Ce
// parcours vérifie la nouvelle page de référence, indépendante de toute recette.

test.beforeAll(async () => {
  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }
});

test("page HACCP : la bibliothèque de règles est accessible depuis la barre latérale, avec le détail complet de chaque règle", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.getByRole("link", { name: "🛡️ HACCP" }).click();
  await expect(page).toHaveURL(/\/haccp$/);

  // Les 5 règles de la bibliothèque (server/utils/haccp.ts) sont affichées avec leur détail
  // complet — pas seulement leur nom.
  await expect(page.getByRole("heading", { name: "⚠ Cuisson" })).toBeVisible();
  const carteCuisson = page.locator("div", { hasText: "⚠ Cuisson" }).last();
  await expect(carteCuisson).toContainText("Survie de microorganismes");
  await expect(carteCuisson).toContainText("Cuisson complète avec contrôle de température");
  await expect(carteCuisson).toContainText("Prolonger la cuisson ou écarter le produit");
  await expect(carteCuisson).toContainText("cuisson"); // mot-clé de détection

  await expect(page.getByRole("heading", { name: "⚠ Refroidissement" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "⚠ Remise en température" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "⚠ Maintien au froid" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "⚠ Traitement des légumes" })).toBeVisible();
});
