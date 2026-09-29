import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";
import { racineStockage } from "../../server/utils/storageDocumentsFournisseur.js";
import path from "node:path";

// Plan d'action, Phase 0 (sécurité des données) : sauvegarde manuelle en attendant le plan Railway
// Pro (sauvegardes automatiques). Ce parcours vérifie la section "Sauvegardes" de Paramètres : liste
// ce qui existe sur le volume et déclenche un vrai téléchargement (pas un affichage) — voir
// prisma/sauvegarder.ts pour le script qui produit ces fichiers.

const NOM_FICHIER = "sauvegarde-2026-06-15T10-30-00-000Z.json";
let cheminFichier: string;

test.beforeAll(async () => {
  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }

  const dossier = path.join(racineStockage(), "sauvegardes");
  await fs.mkdir(dossier, { recursive: true });
  cheminFichier = path.join(dossier, NOM_FICHIER);
  await fs.writeFile(cheminFichier, JSON.stringify({ Societe: [] }), "utf8");
});

test.afterAll(async () => {
  await fs.rm(cheminFichier, { force: true });
});

test("paramètres : la sauvegarde présente sur le volume est listée et se télécharge réellement", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto("/parametres");
  await expect(page.getByRole("heading", { name: "Sauvegardes" })).toBeVisible();
  await expect(page.getByText(NOM_FICHIER)).toHaveCount(0); // le nom du fichier lui-même n'est jamais affiché, seulement sa date/taille
  await expect(page.getByRole("button", { name: "Télécharger" })).toBeVisible();

  const telechargementPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger" }).click();
  const telechargement = await telechargementPromise;
  expect(telechargement.suggestedFilename()).toBe(NOM_FICHIER);
});
