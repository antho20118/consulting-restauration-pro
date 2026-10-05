import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Chantier séparation CONSULTER / PRODUIRE : parcours navigateur réel du nouvel écran de
// planification de production — jusque-là, la fiche recette embarquait un simple calculateur de
// mise à l'échelle (sans stock ni achat) ; ce parcours exerce à la place les deux endpoints déjà
// existants et déjà testés côté serveur (POST /api/production/planifier, POST
// /api/achats/proposition), consommés pour la première fois par un écran dédié
// (/production/:recetteId).

let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteKgId: number;
let conditionnementId: number;
let conditionnementNom: string;
let fournisseurId: number;
let articleId: number;
let recetteId: number;

test.beforeAll(async () => {
  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Sac" } }));
  conditionnementId = conditionnement.id;
  conditionnementNom = conditionnement.nom;

  const fournisseur = await prisma.fournisseur.create({
    data: { nom: "E2E PRODUCTION Fournisseur", societeId },
  });
  fournisseurId = fournisseur.id;

  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E PRODUCTION Article", categorieId, tvaId, societeId, rendement: 100, actif: true },
  });
  articleId = article.id;

  // Conditionnement de 5kg à 50€ HT (10€/kg) : sert à vérifier l'arrondi au conditionnement
  // supérieur dans la proposition d'achat, pas seulement le calcul du besoin net.
  await prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId: uniteKgId, conditionnementId, quantiteConditionnement: 5, prixHT: 50, actif: true },
  });

  // 1kg pour 4 portions (tel qu'écrit sur la fiche) : cible 40 portions → échelle ×10 →
  // quantiteProduction = 10kg, sans dépôt sélectionné donc besoinNet = quantiteProduction.
  const recette = await prisma.recette.create({
    data: {
      nom: "E2E PRODUCTION Recette",
      portions: 4,
      societeId,
      categorieId,
      lignes: { create: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }] },
    },
  });
  recetteId = recette.id;
});

test.afterAll(async () => {
  await prisma.recetteLigne.deleteMany({ where: { recetteId } });
  await prisma.recette.delete({ where: { id: recetteId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.delete({ where: { id: articleId } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
});

test("planification de production : fiche recette → écran dédié → besoins nets → proposition d'achat", async ({ page }) => {
  // Un seul login pour tout ce parcours (voir server/routes/auth.ts : tentatives de connexion
  // limitées par IP) — le reste de la suite e2e partage déjà tout son budget de connexions, pas
  // de raison d'en consommer une deuxième pour ce qui reste un seul scénario bout en bout.
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  // La fiche recette n'embarque plus de calculateur de production : seulement un lien vers
  // l'écran dédié.
  await page.goto("/recettes");
  await page.getByText("E2E PRODUCTION Recette").click();
  await expect(page.getByRole("heading", { name: "E2E PRODUCTION Recette" })).toBeVisible();
  await expect(page.getByText("Calculateur de production")).toHaveCount(0);

  await page.getByRole("link", { name: "🏭 Planifier une production" }).click();

  await expect(page).toHaveURL(new RegExp(`/production/${recetteId}$`));
  await expect(page.getByRole("heading", { name: /E2E PRODUCTION Recette/ })).toBeVisible();

  // Cible pré-remplie avec les portions de la recette (4).
  const champCible = page.locator('input[inputmode="decimal"]');
  await expect(champCible).toHaveValue("4");
  await champCible.fill("40");
  await expect(champCible).toHaveValue("40");

  await page.getByRole("button", { name: "Planifier" }).click();

  await expect(page.getByText("E2E PRODUCTION Article")).toBeVisible();
  const ligneBesoins = page.locator("tr", { hasText: "E2E PRODUCTION Article" }).first();
  await expect(ligneBesoins).toContainText("10.00 kg"); // quantité de production
  await expect(ligneBesoins).toContainText("0.00 kg"); // stock disponible (aucun dépôt sélectionné)

  await page.getByRole("button", { name: "Générer la proposition d'achat" }).click();

  const ligneAchat = page.locator("tr", { hasText: "E2E PRODUCTION Fournisseur" }).first();
  await expect(ligneAchat).toContainText(`2 × ${conditionnementNom}`);
  await expect(ligneAchat).toContainText("100.00 €");
  await expect(page.getByText("Total HT : 100.00 €")).toBeVisible();

  // Retour à l'écran de choix de recette.
  await page.getByRole("link", { name: "← Retour au choix de la recette" }).click();
  await expect(page).toHaveURL(/\/production$/);
});
