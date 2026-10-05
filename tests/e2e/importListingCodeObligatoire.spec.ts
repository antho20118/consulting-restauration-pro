import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Correction de l'anomalie UX relevée par l'audit indépendant de la correction « identification des
// articles lors des imports de listings fournisseurs » : le champ "Code produit fournisseur" du
// modal d'import Excel/CSV (ImportListingModal.tsx) restait étiqueté "(optionnel)" et ne bloquait
// pas l'analyse quand l'import était lancé depuis la fiche fournisseur — alors même que le serveur
// refuse déjà toute ligne sans code dans ce contexte (statut code_produit_manquant). Ce test navigateur
// réel prouve que l'utilisateur est désormais bloqué CÔTÉ INTERFACE avant même d'atteindre le serveur,
// puis peut effectivement lancer l'analyse une fois la colonne mappée — sans toucher à la logique
// métier déjà validée (identité fournisseurId+codeProduitFournisseur, normalisation, rapprochement).

let fournisseurId: number;

test.beforeAll(async () => {

  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "E2E CODE OBLIGATOIRE Fournisseur", societeId: societe.id } });
  fournisseurId = fournisseur.id;
});

test.afterAll(async () => {
  const documents = await prisma.documentFournisseur.findMany({ where: { fournisseurId }, select: { id: true } });
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { documentId: { in: documents.map((d) => d.id) } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.produitFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.tarifArticle.deleteMany({ where: { fournisseurId } });
  await prisma.article.deleteMany({ where: { nom: { startsWith: "E2E CODE OBLIGATOIRE" } } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
});

test("import listing (fiche fournisseur) : code produit fournisseur non mappé bloque l'analyse côté UI, mappé la débloque", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto(`/fournisseurs/${fournisseurId}?onglet=listings`);
  await page.getByRole("button", { name: "Importer un listing", exact: true }).click();

  const csv = "designation,prix,codeProduitFournisseur\nE2E CODE OBLIGATOIRE Article,10.00,E2E-CODE-001\n";
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-code-obligatoire.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });

  // Étape 2 (mapping) : le libellé doit désormais dire explicitement que le code est obligatoire
  // dans ce contexte, jamais "(optionnel)".
  await expect(page.getByText("Code produit fournisseur * (obligatoire pour cet import)")).toBeVisible();
  await expect(page.getByText("Code produit fournisseur (optionnel)")).toHaveCount(0);

  const ligneDesignation = page.locator("div").filter({ hasText: /^Désignation \*/ }).locator("select");
  const lignePrix = page.locator("div").filter({ hasText: /^Prix \*/ }).locator("select");
  await ligneDesignation.selectOption("designation");
  await lignePrix.selectOption("prix");

  // Colonne "codeProduitFournisseur" volontairement laissée sur "— aucune —" : scénario 1.
  await page.getByRole("button", { name: "Analyser" }).click();
  await expect(
    page.getByText("Le code produit fournisseur est obligatoire pour un import depuis la fiche fournisseur")
  ).toBeVisible();
  // Toujours à l'étape 2 (mapping) : l'analyse n'a jamais été lancée, jamais d'appel serveur inutile.
  await expect(page.getByRole("button", { name: "Analyser" })).toBeVisible();
  await expect(ligneDesignation).toBeVisible();

  // Scénario 2 : la colonne est mappée, l'analyse doit maintenant être possible.
  const ligneCodeProduit = page
    .locator("div")
    .filter({ hasText: /^Code produit fournisseur \* \(obligatoire pour cet import\)/ })
    .locator("select");
  await ligneCodeProduit.selectOption("codeProduitFournisseur");
  await page.getByRole("button", { name: "Analyser" }).click();

  await expect(
    page.getByText("Le code produit fournisseur est obligatoire pour un import depuis la fiche fournisseur")
  ).toHaveCount(0);
  // Étape 3 (prévisualisation) atteinte : la ligne proposée porte bien la désignation du fichier.
  await expect(page.getByText("E2E CODE OBLIGATOIRE Article")).toBeVisible({ timeout: 10_000 });
});
