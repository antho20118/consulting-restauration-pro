import { test, expect } from "@playwright/test";
import { creerAdminDeTestAvecSociete, creerSuperAdminDeTestAvecSociete } from "../helpers/auth.js";
import prisma from "../../server/prisma.js";

// F11 de l'audit forensique, volet UI : TVA et Unité sont des référentiels partagés entre toutes
// les sociétés (voir schema.prisma et server/middleware/autoriserEcritureSuperAdmin.ts, qui refuse
// déjà toute écriture côté serveur à qui n'est pas superAdmin). Avant ce correctif, TvaManager et
// UnitesManager affichaient des champs et boutons pleinement interactifs à TOUT utilisateur
// connecté, qui échouaient silencieusement (toast d'erreur 403) au clic pour un PROPRIETAIRE
// normal — ce parcours vérifie que l'UI reflète désormais la même restriction que le serveur,
// pour les deux comptes (même principe que sauvegardesParametres.spec.ts pour la section
// Sauvegardes).

const NOM_TVA = `E2E Gating TVA ${Date.now()}`;
const NOM_UNITE = `E2E Gating Unite ${Date.now()}`;

test.beforeAll(async () => {
  await creerAdminDeTestAvecSociete();
  await creerSuperAdminDeTestAvecSociete();
});

test.afterAll(async () => {
  await prisma.tVA.deleteMany({ where: { nom: NOM_TVA } });
  await prisma.unite.deleteMany({ where: { nom: NOM_UNITE } });
});

test("paramètres : un PROPRIETAIRE normal voit TVA/Unités en lecture seule, sans contrôle d'édition", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant", { exact: true }).fill("admin");
  await page.getByLabel("Code", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant", { exact: true })).toBeHidden({ timeout: 15_000 });

  await page.goto("/parametres");
  await expect(page.getByRole("heading", { name: "TVA" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unités" })).toBeVisible();

  // Le message explicatif remplace les formulaires d'ajout — vérifie son absence plutôt que sa
  // présence pour chaque champ (un simple <input> resterait ambigu avec d'autres sections de la
  // page Paramètres).
  await expect(page.getByText("modification réservée à l'administrateur de la plateforme")).toHaveCount(2);
  await expect(page.getByPlaceholder("Nom (ex. TVA 10 %)")).toHaveCount(0);
  await expect(page.getByPlaceholder("Symbole")).toHaveCount(0);
});

test("paramètres : l'opérateur (superAdmin) peut réellement ajouter un taux de TVA et une unité", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant", { exact: true }).fill("super-admin");
  await page.getByLabel("Code", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant", { exact: true })).toBeHidden({ timeout: 15_000 });

  await page.goto("/parametres");
  await expect(page.getByPlaceholder("Nom (ex. TVA 10 %)")).toBeVisible();

  await page.getByPlaceholder("Nom (ex. TVA 10 %)").fill(NOM_TVA);
  await page.getByPlaceholder("Nom (ex. TVA 10 %)").locator("..").getByRole("button", { name: "Ajouter" }).click();
  // La ligne ajoutée est un <input> contrôlé (édition immédiate), jamais un simple texte —
  // getByText ne voit pas la valeur d'un champ de saisie, d'où une vérification par valeur.
  await expect(page.locator(`input[value="${NOM_TVA}"]`)).toHaveCount(1);

  await page.getByPlaceholder("Nom", { exact: true }).fill(NOM_UNITE);
  await page.getByPlaceholder("Symbole").fill("eu");
  await page
    .getByPlaceholder("Nom", { exact: true })
    .locator("..")
    .getByRole("button", { name: "Ajouter" })
    .click();
  await expect(page.locator(`input[value="${NOM_UNITE}"]`)).toHaveCount(1);
});
