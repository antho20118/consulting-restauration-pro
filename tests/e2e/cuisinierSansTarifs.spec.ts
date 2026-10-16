import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Point 7 de l'audit du 15/10 — « Les cuisiniers ne doivent voir aucun tarif. » Parcours réel d'un
// compte CUISINIER : écrans de gestion absents du menu et inaccessibles par leur adresse, fiche
// recette et liste des menus sans aucun montant, consultation seule. Le serveur, lui, est couvert
// par tests/unit/cuisinierSansTarifs.test.ts (réponses expurgées, routes fermées).

const IDENTIFIANT = "e2e-cuisinier-tarifs";
let societeId: number;
let utilisateurId: number;
let fournisseurId: number;
let articleId: number;
let recetteId: number;
let menuId: number;

test.beforeAll(async () => {
  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  await prisma.utilisateur.deleteMany({ where: { identifiant: IDENTIFIANT } });
  utilisateurId = (
    await prisma.utilisateur.create({
      data: { identifiant: IDENTIFIANT, codeHache: hacherCode("1234"), role: "CUISINIER", societeId },
    })
  ).id;
  const categorieId = (
    (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ??
    (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }))
  ).id;
  const tvaId = (
    (await prisma.tVA.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }))
  ).id;
  const kgId = (
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }))
  ).id;
  const conditionnementId = (
    (await prisma.conditionnement.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.conditionnement.create({ data: { nom: "Unité" } }))
  ).id;
  fournisseurId = (await prisma.fournisseur.create({ data: { nom: "E2E Cuisinier fournisseur", societeId, codeFournisseur: "FOU-TEST" } })).id;
  articleId = (
    await prisma.article.create({ data: { nom: "E2E Cuisinier carottes", type: "MATIERE_PREMIERE", categorieId, tvaId, societeId } })
  ).id;
  await prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId: kgId, conditionnementId, quantiteConditionnement: 1, prixHT: 43.219, actif: true },
  });
  recetteId = (
    await prisma.recette.create({
      data: {
        nom: "E2E Cuisinier purée",
        societeId,
        portions: 2,
        prixVenteHT: 87.65,
        lignes: { create: [{ articleId, quantite: 1, uniteId: kgId }] },
      },
    })
  ).id;
  menuId = (
    await prisma.menu.create({
      data: { nom: "E2E Cuisinier menu", societeId, prixVenteHT: 76.54, lignes: { create: [{ recetteId, quantite: 1 }] } },
    })
  ).id;
});

test.afterAll(async () => {
  await prisma.menu.deleteMany({ where: { id: menuId } });
  await prisma.recetteLigne.deleteMany({ where: { recetteId } });
  await prisma.recette.deleteMany({ where: { id: recetteId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.deleteMany({ where: { id: articleId } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
  await prisma.utilisateur.deleteMany({ where: { id: utilisateurId } });
});

test("cuisinier : aucun tarif, écrans de gestion absents, consultation seule", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill(IDENTIFIANT);
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  // Accueil (tableau de bord) fermé : renvoyé aux fiches recettes.
  await expect(page).toHaveURL(/\/recettes$/);
  const menuLateral = page.locator("aside");
  for (const absent of ["Tableau de bord", "Base ingrédients", "Fournisseurs", "Commandes fournisseurs", "Ventes", "Menu engineering", "Prévisions", "Questions / Réponses", "Dépôts"]) {
    await expect(menuLateral.getByRole("link", { name: absent })).toHaveCount(0);
  }
  // Libellés exacts du menu (src/layouts/Sidebar.tsx) : « HACCP » seul est aussi contenu dans
  // « Traçabilité HACCP ».
  for (const present of ["📖 Fiches recettes", "🍽️ Menus", "🏭 Production", "🛡️ HACCP", "📋 Traçabilité HACCP", "📦 Mouvements de stock", "⚙ Paramètres"]) {
    await expect(menuLateral.getByRole("link", { name: present, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole("button", { name: "+ Nouvelle recette" })).toHaveCount(0);

  // Fiche recette : ingrédients et quantités, sans aucun coût ni prix.
  await page.getByRole("button", { name: "E2E Cuisinier purée" }).click();
  await expect(page.getByText("E2E Cuisinier carottes")).toBeVisible();
  await expect(page.getByText(/Coût|Prix de vente|Food cost|€/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Modifier" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Supprimer" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Planifier une production/ })).toBeVisible();
  await page.getByRole("button", { name: "Fermer" }).click();

  // Liste des menus : ni colonne de montant, ni actions de gestion.
  await page.goto("/menus");
  await expect(page.getByText("E2E Cuisinier menu")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("columnheader", { name: /Coût|Prix de vente|Food cost|Actions/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Nouveau menu" })).toHaveCount(0);

  // Écran de gestion demandé par son adresse : renvoyé aux fiches recettes.
  await page.goto("/fournisseurs");
  await expect(page).toHaveURL(/\/recettes$/);
});
