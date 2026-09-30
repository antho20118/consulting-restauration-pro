import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerAdminDeTestAvecSociete } from "../helpers/auth.js";

// Audit backend→interface (priorité 2, restant) : POST/PUT/DELETE /sous-categories-recette
// existaient déjà côté serveur (CRUD complet, y compris la protection contre la suppression d'une
// sous-catégorie encore utilisée par des recettes) mais aucune interface ne permettait de les
// créer, renommer ou supprimer — seule leur lecture (pour peupler un menu déroulant dans les
// formulaires de recette) était exposée. Ce parcours vérifie le nouveau gestionnaire dans
// Paramètres.

test.beforeAll(async () => {
  await creerAdminDeTestAvecSociete();
});

test.afterAll(async () => {
  await prisma.sousCategorieRecette.deleteMany({ where: { nom: { startsWith: "E2E SOUSCAT" } } });
});

test("paramètres : créer, renommer et supprimer une sous-catégorie de recette", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto("/parametres");
  await expect(page.getByText("Sous-catégories de recettes")).toBeVisible();

  const section = page.locator("div", { hasText: "Sous-catégories de recettes" }).last();
  const champsNom = section.locator("input[type=text]");

  // Chaque ligne partage le même champ générique (pas de libellé propre à afficher son nom
  // actuel) : la ligne créée est retrouvée par la VALEUR courante de ces champs (lue en JS, pas
  // via l'attribut HTML value qu'un input contrôlé React ne tient jamais à jour) plutôt que par un
  // texte ou un rôle, faute de tout autre repère stable dans ce gestionnaire.
  async function trouverChampParValeur(valeur: string) {
    const valeurs = await champsNom.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    const index = valeurs.indexOf(valeur);
    return index >= 0 ? champsNom.nth(index) : null;
  }

  // Création d'une sous-catégorie racine.
  await section.getByPlaceholder("Nouvelle sous-catégorie (ex. Bœuf, Veau…)").fill("E2E SOUSCAT Viande");
  await section.getByRole("button", { name: "Ajouter" }).click();

  await expect(async () => {
    expect(await trouverChampParValeur("E2E SOUSCAT Viande")).not.toBeNull();
  }).toPass();

  const enBaseRacine = await prisma.sousCategorieRecette.findFirstOrThrow({
    where: { nom: "E2E SOUSCAT Viande" },
  });
  expect(enBaseRacine.parentId).toBeNull();

  // Localisé par position (nth) plutôt que par valeur à partir d'ici : la position reste stable
  // pendant le remplissage ci-dessous (aucun rechargement de la liste avant le clic sur
  // Enregistrer), contrairement à la valeur qui, elle, change justement au renommage.
  const champNom = await trouverChampParValeur("E2E SOUSCAT Viande");
  if (!champNom) throw new Error("Champ de la sous-catégorie introuvable");
  // .filter({ has: locator }) re-résout toute la chaîne du locator interne à l'intérieur de
  // chaque candidat, ce qui échoue ici : champNom part de "section" (qui identifie sa ligne via
  // le texte du titre "Sous-catégories de recettes", absent des descendants d'une ligne) — une
  // simple remontée XPath vers le parent direct est ce qu'il faut, pas un filtre.
  const ligne = champNom.locator("xpath=..");

  // Renommage.
  await champNom.fill("E2E SOUSCAT Viande Rouge");
  await ligne.getByRole("button", { name: "Enregistrer" }).click();

  await expect(async () => {
    const enBase = await prisma.sousCategorieRecette.findUniqueOrThrow({ where: { id: enBaseRacine.id } });
    expect(enBase.nom).toBe("E2E SOUSCAT Viande Rouge");
  }).toPass();

  // Suppression.
  page.once("dialog", (dialog) => dialog.accept());
  await ligne.getByRole("button", { name: "Supprimer" }).click();

  await expect(async () => {
    const encoreLa = await prisma.sousCategorieRecette.findUnique({ where: { id: enBaseRacine.id } });
    expect(encoreLa).toBeNull();
  }).toPass();
});
