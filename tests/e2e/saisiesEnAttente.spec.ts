import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";
import { hacherCode } from "../../server/utils/auth.js";

// Revue des chantiers de l'audit du 15/10 :
// 1. une saisie faite sans réseau et refusée par le serveur au retour du réseau (ici : recette
//    supprimée entre-temps) restait en file pour toujours, sans motif visible ni moyen d'en sortir —
//    seul « N actions en attente » s'affichait ; le contrôle HACCP qui en dépendait restait bloqué
//    avec elle. L'écran « Saisies en attente » montre le motif et permet d'abandonner.
// 2. un rôle changé par le PROPRIETAIRE n'apparaissait dans les menus qu'après une reconnexion :
//    le compte est désormais relu à chaque ouverture de l'application (renouvellement de session).

const IDENTIFIANT_CUISINIER = "e2e-saisies-role";
let societeId: number;
let recetteId: number;

test.beforeAll(async () => {
  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  await creerUtilisateurAdminDeTest(societeId);
  await prisma.utilisateur.deleteMany({ where: { identifiant: IDENTIFIANT_CUISINIER } });
  await prisma.utilisateur.create({
    data: { identifiant: IDENTIFIANT_CUISINIER, codeHache: hacherCode("1234"), role: "CUISINIER", societeId },
  });
  recetteId = (
    await prisma.recette.create({
      data: {
        nom: "E2E SAISIES Recette",
        portions: 1,
        societeId,
        etapes: { create: [{ ordre: 1, description: "E2E SAISIES cuisson", pointCritiqueHACCP: true, controleHACCP: "≥ 63 °C" }] },
      },
    })
  ).id;
});

test.afterAll(async () => {
  await prisma.recetteEtape.deleteMany({ where: { recetteId } });
  await prisma.recette.deleteMany({ where: { id: recetteId } });
  await prisma.utilisateur.deleteMany({ where: { identifiant: IDENTIFIANT_CUISINIER } });
});

async function connecter(page: import("@playwright/test").Page, identifiant: string) {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill(identifiant);
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });
}

test("saisie refusée au retour du réseau : motif affiché, production et contrôle abandonnés", async ({ page, context }) => {
  await connecter(page, "admin");
  await page.goto(`/production/${recetteId}`);
  await expect(page.getByRole("heading", { name: /E2E SAISIES Recette/ })).toBeVisible({ timeout: 15_000 });

  await context.setOffline(true);
  await page.getByRole("button", { name: "Planifier" }).click();
  await page.getByRole("button", { name: "Enregistrer la production" }).click();
  await page.getByPlaceholder("Valeur constatée (ex. 72°C)").fill("75 °C");
  await page.getByRole("button", { name: "Enregistrer le contrôle" }).click();
  await expect(page.getByRole("link", { name: /2 actions en attente/ })).toBeVisible();

  // Pendant ce temps, la recette est supprimée : la production sera refusée à l'envoi.
  await prisma.recetteEtape.deleteMany({ where: { recetteId } });
  await prisma.recette.deleteMany({ where: { id: recetteId } });

  await context.setOffline(false);
  const indicateur = page.getByRole("link", { name: /2 actions en attente de synchronisation — dont 1 refusée, à vérifier/ });
  await expect(indicateur).toBeVisible({ timeout: 15_000 });
  await indicateur.click();

  await expect(page.getByRole("heading", { name: "📡 Saisies en attente" })).toBeVisible();
  const saisies = page.getByTestId("saisie-en-attente");
  await expect(saisies).toHaveCount(2);
  const production = saisies.filter({ hasText: "E2E SAISIES Recette — 1 portion" });
  await expect(production).toContainText("⛔ Refusée : Recette introuvable");
  const controle = saisies.filter({ hasText: "E2E SAISIES Recette — E2E SAISIES cuisson : 75 °C" });
  await expect(controle).toContainText("⏸ Bloqué : sa production a été refusée");

  page.once("dialog", (dialogue) => {
    expect(dialogue.message()).toContain("ainsi que 1 contrôle HACCP qui en dépend");
    dialogue.accept();
  });
  await production.getByRole("button", { name: "Abandonner" }).click();
  await expect(page.getByText("Aucune saisie en attente : tout est enregistré.")).toBeVisible();
  await expect(page.getByRole("link", { name: /en attente de synchronisation/ })).toHaveCount(0);
});

test("rôle changé par le propriétaire : appliqué aux menus à la réouverture, sans reconnexion", async ({ page }) => {
  await connecter(page, IDENTIFIANT_CUISINIER);
  await expect(page.getByRole("link", { name: "📖 Fiches recettes", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "🏠 Tableau de bord", exact: true })).toHaveCount(0);

  await prisma.utilisateur.update({ where: { identifiant: IDENTIFIANT_CUISINIER }, data: { role: "CHEF" } });
  await page.reload();
  await expect(page.getByRole("link", { name: "🏠 Tableau de bord", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Identifiant")).toHaveCount(0);
  const memorise = await page.evaluate(() => JSON.parse(localStorage.getItem("consulting_utilisateur") ?? "null"));
  expect(memorise?.role).toBe("CHEF");
});

// Sur téléphone, au retour de staging : l'appui sur le compteur juste après une saisie hors ligne
// ne faisait rien. Deux causes : les notifications (« … mise en attente de synchronisation »)
// s'affichaient par-dessus le compteur du menu et recevaient le toucher ; et l'écran des saisies
// en attente, chargé à la demande, ne pouvait pas l'être sans réseau quand le navigateur n'avait
// rien gardé pour le hors-ligne (navigation privée, mise à jour pas encore installée). Ici, le
// serveur de développement joue ce dernier cas : hors ligne, rien ne peut plus être chargé.
test.describe("sur téléphone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("hors ligne, juste après la saisie : le compteur du menu ouvre l'écran des saisies en attente", async ({ page, context }) => {
    const societeId = (await prisma.societe.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
    const idRecette = (
      await prisma.recette.create({
        data: {
          nom: "E2E SAISIES Mobile",
          portions: 1,
          societeId,
          etapes: { create: [{ ordre: 1, description: "E2E SAISIES Mobile cuisson", pointCritiqueHACCP: true }] },
        },
      })
    ).id;
    try {
      await connecter(page, "admin");
      await page.goto(`/production/${idRecette}`);
      await expect(page.getByRole("heading", { name: /E2E SAISIES Mobile/ })).toBeVisible({ timeout: 15_000 });

      await context.setOffline(true);
      await page.getByRole("button", { name: "Planifier" }).tap();
      await page.getByRole("button", { name: "Enregistrer la production" }).tap();
      await page.getByPlaceholder("Valeur constatée (ex. 72°C)").fill("75 °C");
      await page.getByRole("button", { name: "Enregistrer le contrôle" }).tap();

      // Les notifications sont encore affichées quand le cuisinier ouvre le menu.
      await expect(page.getByText("Contrôle mis en attente de synchronisation.")).toBeVisible();
      await page.getByRole("button", { name: "Ouvrir le menu" }).tap();
      await page.getByRole("link", { name: /2 actions en attente/ }).tap({ timeout: 2_000 });
      await expect(page.getByRole("heading", { name: "📡 Saisies en attente" })).toBeVisible({ timeout: 5_000 });

      page.once("dialog", (dialogue) => dialogue.accept());
      await page.getByTestId("saisie-en-attente").filter({ hasText: "E2E SAISIES Mobile — 1 portion" }).getByRole("button", { name: "Abandonner" }).tap();
      await expect(page.getByText("Aucune saisie en attente : tout est enregistré.")).toBeVisible();
    } finally {
      await prisma.recetteEtape.deleteMany({ where: { recetteId: idRecette } });
      await prisma.recette.deleteMany({ where: { id: idRecette } });
    }
  });
});
