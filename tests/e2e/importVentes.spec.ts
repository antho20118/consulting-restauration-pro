import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Parcours complet du chantier ventes (import CSV/Excel d'un export de caisse enregistreuse,
// rapprochement produit vendu -> recette, réconciliation food cost théorique/réel) — voir cadrage
// « Part sur import d'un fichier CSV/Excel de ventes par produit, avec un rapprochement produit-
// vendu → recette (même principe que le rapprochement déjà utilisé pour les listings
// fournisseurs) ». Même modèle que importListingCodeObligatoire.spec.ts, appliqué à ImportVentesModal.

let societeId: number;
let fournisseurId: number;
let articleId: number;
let recetteId: number;
const nomRecette = "E2E VENTES Poulet roti maison";

test.beforeAll(async () => {
  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  await creerUtilisateurAdminDeTest(societeId);

  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  const conditionnement = (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Carton" } }));

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "E2E VENTES Fournisseur", societeId } });
  fournisseurId = fournisseur.id;

  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E VENTES Article Volaille", categorieId: categorie.id, tvaId: tva.id, societeId },
  });
  articleId = article.id;
  await prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId: uniteKg.id, conditionnementId: conditionnement.id, quantiteConditionnement: 1, prixHT: 8 },
  });

  const recette = await prisma.recette.create({
    data: {
      societeId,
      nom: nomRecette,
      portions: 1,
      prixVenteHT: 18,
      lignes: { create: [{ articleId, quantite: 1, uniteId: uniteKg.id, gainCuissonPct: 0, ordre: 0 }] },
    },
  });
  recetteId = recette.id;
});

test.afterAll(async () => {
  const documents = await prisma.documentVentes.findMany({ where: { societeId }, select: { id: true } });
  await prisma.ligneVente.deleteMany({ where: { documentVentesId: { in: documents.map((d) => d.id) } } });
  await prisma.documentVentes.deleteMany({ where: { societeId } });
  await prisma.aliasProduitVenduImport.deleteMany({ where: { recetteId } });
  await prisma.recetteLigne.deleteMany({ where: { recetteId } });
  await prisma.recette.delete({ where: { id: recetteId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.delete({ where: { id: articleId } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
});

test("import de ventes : upload CSV, rapprochement automatique, écriture, réconciliation food cost", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant", { exact: true }).fill("admin");
  await page.getByLabel("Code", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant", { exact: true })).toBeHidden({ timeout: 15_000 });

  await page.goto("/ventes");
  await page.getByRole("button", { name: "Importer des ventes" }).click();

  const csv = `designation,quantite,prixUnitaire\n${nomRecette},5,18\n`;
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-ventes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });

  const ligneDesignation = page.locator("div").filter({ hasText: /^Désignation du produit \*/ }).locator("select");
  const ligneQuantite = page.locator("div").filter({ hasText: /^Quantité vendue \*/ }).locator("select");
  const lignePrix = page.locator("div").filter({ hasText: /^Prix de vente unitaire/ }).locator("select");
  await ligneDesignation.selectOption("designation");
  await ligneQuantite.selectOption("quantite");
  await lignePrix.selectOption("prixUnitaire");

  await page.getByRole("button", { name: "Analyser" }).click();

  // Étape 3 : la désignation du fichier correspond exactement au nom de la recette suivie —
  // rapprochement "certaine" (DESIGNATION_EXACTE), préconfirmé, checkbox déjà cochée.
  await expect(page.getByText(nomRecette).first()).toBeVisible({ timeout: 10_000 });
  const checkbox = page.getByLabel("Inclure cette vente dans la réconciliation");
  await expect(checkbox).toBeChecked();

  await page.getByRole("button", { name: "Lancer l'import" }).click();

  await expect(page.getByText("1 vente(s) rapprochée(s) et enregistrée(s)")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Fermer" }).click();

  // La réconciliation affiche désormais la recette avec sa quantité vendue et son food cost réel
  // (5 ventes à 18€, coût théorique dérivé du tarif article de la fixture).
  await expect(page.getByText(nomRecette)).toBeVisible();
  const ligneReconciliation = page.locator("tr", { hasText: nomRecette });
  await expect(ligneReconciliation).toContainText("5");
  await expect(ligneReconciliation).toContainText("90.00 €"); // 5 x 18 €

  // Historique des imports : une ligne rapprochée, aucune ignorée.
  await expect(page.getByText("e2e-ventes.csv")).toBeVisible();
});
