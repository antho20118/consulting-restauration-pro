import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Audit backend→interface (priorité 2) : POST /fournisseurs/:id/reactiver existait déjà côté
// serveur (soft-delete réversible, id/codeFournisseur jamais régénérés) mais aucun chemin
// utilisateur ne permettait de retrouver, ni donc de réactiver, un fournisseur désactivé — il
// disparaissait simplement de GET /fournisseurs (filtré actif:true par défaut). Ce parcours
// vérifie le nouveau filtre "Afficher aussi les fournisseurs désactivés" et l'action Réactiver.

let societeId: number;
let fournisseurId: number;

test.beforeAll(async () => {
  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  societeId = societe.id;

  // Créé directement désactivé (equivalent d'un DELETE déjà effectué) : ce test porte sur la
  // réactivation, pas sur la désactivation elle-même (déjà couverte ailleurs).
  const fournisseur = await prisma.fournisseur.create({
    data: { nom: "E2E REACTIVATION Fournisseur", societeId, actif: false },
  });
  fournisseurId = fournisseur.id;
});

test.afterAll(async () => {
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
});

test("fournisseurs : un fournisseur désactivé est invisible par défaut, visible et réactivable via le filtre dédié", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto("/fournisseurs");

  // Invisible par défaut (GET /fournisseurs filtre actif:true).
  await expect(page.getByText("E2E REACTIVATION Fournisseur")).toHaveCount(0);

  await page.getByLabel("Afficher aussi les fournisseurs désactivés").check();

  await expect(page.getByRole("heading", { name: "Fournisseurs désactivés" })).toBeVisible();
  await expect(page.getByText("E2E REACTIVATION Fournisseur")).toBeVisible();

  // Seul fournisseur désactivé créé par ce test : un seul bouton "Réactiver" présent sur la page.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Réactiver" }).click();

  // Le fournisseur quitte la section "désactivés" et rejoint la liste active normale.
  await expect(page.getByRole("heading", { name: "Fournisseurs désactivés" })).toHaveCount(0);
  await expect(page.getByText("E2E REACTIVATION Fournisseur")).toBeVisible();

  const enBase = await prisma.fournisseur.findUniqueOrThrow({ where: { id: fournisseurId } });
  expect(enBase.actif).toBe(true);
});
