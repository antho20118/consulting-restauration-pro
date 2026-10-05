import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Chantier listings/factures fournisseurs, Phase 5 : parcours navigateur réel de la fiche
// fournisseur — liste → ouverture → 4 onglets → retour liste. Backend + frontend Vite réellement
// démarrés (voir tests/e2e/importListingPhoto.spec.ts pour le même principe de bootstrap).

let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let articleId: number;

test.beforeAll(async () => {
  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  const conditionnement = (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Sac" } }));

  const fournisseur = await prisma.fournisseur.create({
    data: { nom: "E2E FICHE FOURNISSEUR Test", telephone: "0102030405", societeId },
  });
  fournisseurId = fournisseur.id;

  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E FICHE FOURNISSEUR Article", categorieId, tvaId, societeId },
  });
  articleId = article.id;
  // Tarif sans document source (créé manuellement) : doit s'afficher normalement dans l'onglet.
  await prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId: uniteKg.id, conditionnementId: conditionnement.id, quantiteConditionnement: 1, prixHT: 12 },
  });
});

test.afterAll(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.delete({ where: { id: articleId } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
});

test("fiche fournisseur : liste → ouverture → 4 onglets → retour liste", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto("/fournisseurs");
  await page.getByText("E2E FICHE FOURNISSEUR Test").waitFor();

  // Chantier « refonte liste fournisseurs » : la liste est désormais une grille de cartes (voir
  // FournisseursGrille.tsx), plus une DataGrid — un fournisseur non homonyme s'ouvre directement au
  // clic sur sa carte, sans passer par le sélecteur d'homonymes.
  await page.getByText("E2E FICHE FOURNISSEUR Test").click();

  await expect(page).toHaveURL(new RegExp(`/fournisseurs/${fournisseurId}$`));
  await expect(page.getByRole("heading", { name: /E2E FICHE FOURNISSEUR Test/ })).toBeVisible();

  // Onglet 1 : Informations (actif par défaut). Le téléphone est aussi affiché en permanence dans
  // l'en-tête (audit ergonomique) ; on vérifie ici précisément le contenu propre à cet onglet.
  await expect(page.getByText("Téléphone : 0102030405")).toBeVisible();

  // Onglet 2 : Articles / Tarifs
  await page.getByRole("button", { name: "Articles / Tarifs" }).click();
  await expect(page.getByText("E2E FICHE FOURNISSEUR Article")).toBeVisible();
  await expect(page.getByText("Source documentaire non disponible")).toBeVisible();

  // Onglet 3 : Listings (vide pour ce fournisseur)
  await page.getByRole("button", { name: "Listings" }).click();
  await expect(page.getByText("Aucun listing importé pour l'instant.")).toBeVisible();

  // Onglet 4 : Factures (toujours vide, fonctionnalité future)
  await page.getByRole("button", { name: "Factures" }).click();
  await expect(page.getByText(/Aucune facture importée pour l'instant/)).toBeVisible();

  // Retour à la liste
  await page.getByRole("button", { name: "← Retour à la liste" }).click();
  await expect(page).toHaveURL(/\/fournisseurs$/);
  await expect(page.getByText("E2E FICHE FOURNISSEUR Test")).toBeVisible();
});
