import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Boucle achats complète (Phase 1 du plan d'action) : jusqu'ici la page Production proposait un
// achat mais rien ne permettait de l'enregistrer, ni de le réceptionner, ni de mettre à jour le
// stock — voir server/routes/commandes.ts. Ce parcours exerce le chemin complet réellement
// disponible dans l'interface : Production → proposition → "Enregistrer la commande" → page
// Commandes → réception → stock mis à jour, avec une vérification finale directement en base pour
// ne jamais se fier uniquement à ce que l'écran affiche.

let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteKgId: number;
let conditionnementId: number;
let conditionnementNom: string;
let fournisseurId: number;
let articleId: number;
let depotId: number;
let recetteId: number;
let commandeId: number;

test.beforeAll(async () => {
  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
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

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "E2E ACHATS Fournisseur", societeId } });
  fournisseurId = fournisseur.id;

  const depot = await prisma.depot.create({ data: { nom: "E2E ACHATS Dépôt", societeId } });
  depotId = depot.id;

  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E ACHATS Article", categorieId, tvaId, societeId, rendement: 100, actif: true },
  });
  articleId = article.id;

  // 5kg à 50€ HT (10€/kg) — même fixture que planificationProduction.spec.ts, pour un besoin de
  // 10kg -> 2 conditionnements, 100€.
  await prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId: uniteKgId, conditionnementId, quantiteConditionnement: 5, prixHT: 50, actif: true },
  });

  const recette = await prisma.recette.create({
    data: {
      nom: "E2E ACHATS Recette",
      portions: 4,
      societeId,
      categorieId,
      lignes: { create: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }] },
    },
  });
  recetteId = recette.id;
});

test.afterAll(async () => {
  await prisma.mouvementStock.deleteMany({ where: { articleId } });
  if (commandeId) {
    await prisma.ligneCommandeFournisseur.deleteMany({ where: { commandeId } });
    await prisma.commandeFournisseur.deleteMany({ where: { id: commandeId } });
  }
  await prisma.stock.deleteMany({ where: { articleId } });
  await prisma.recetteLigne.deleteMany({ where: { recetteId } });
  await prisma.recette.delete({ where: { id: recetteId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.delete({ where: { id: articleId } });
  await prisma.depot.delete({ where: { id: depotId } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
});

test("boucle achats complète : Production -> proposition -> commande enregistrée -> réception -> stock mis à jour", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto(`/production/${recetteId}`);
  await expect(page.getByRole("heading", { name: /E2E ACHATS Recette/ })).toBeVisible();

  // Un dépôt est obligatoire pour enregistrer une vraie commande (contrairement à la simple
  // prévisualisation) — voir cadrage.
  await page.getByRole("combobox").selectOption({ label: "E2E ACHATS Dépôt" });

  const champCible = page.locator('input[inputmode="decimal"]');
  await champCible.fill("40");
  await page.getByRole("button", { name: "Planifier" }).click();
  await expect(page.getByText("E2E ACHATS Article")).toBeVisible();

  await page.getByRole("button", { name: "Générer la proposition d'achat" }).click();
  const ligneAchat = page.locator("tr", { hasText: "E2E ACHATS Fournisseur" }).first();
  await expect(ligneAchat).toContainText(`2 × ${conditionnementNom}`);
  await expect(page.getByText("Total HT : 100.00 €")).toBeVisible();

  await expect(page.getByRole("button", { name: "Enregistrer la commande" })).toBeEnabled();
  await page.getByRole("button", { name: "Enregistrer la commande" }).click();
  await expect(page.getByText("commande(s) enregistrée(s)")).toBeVisible();

  const lienCommande = page.getByRole("link", { name: "voir la commande" });
  await expect(lienCommande).toBeVisible();
  const href = await lienCommande.getAttribute("href");
  commandeId = Number(href?.split("/").pop());
  expect(commandeId).toBeGreaterThan(0);

  await lienCommande.click();
  await expect(page).toHaveURL(new RegExp(`/commandes/${commandeId}$`));
  // Premier accès à ce module chargé à la demande (lazy) : laisse à Vite le temps de le compiler
  // à la volée en dev, plus long qu'un simple rendu React — d'où un délai généreux ici seulement.
  await expect(page.getByRole("heading", { name: `Commande #${commandeId}` })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("En attente")).toBeVisible();
  await expect(page.getByText("10000 g")).toBeVisible(); // quantité commandée, unité de base

  // Le champ de quantité reçue est pré-rempli avec la quantité commandée — réception complète
  // sans rien modifier.
  await page.getByRole("button", { name: "Valider la réception" }).click();
  await expect(page.getByText("Commande reçue en totalité, stock mis à jour.")).toBeVisible();
  await expect(page.getByText("Reçue", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Valider la réception" })).toHaveCount(0);

  const stock = await prisma.stock.findUniqueOrThrow({ where: { articleId_depotId: { articleId, depotId } } });
  expect(stock.quantite).toBe(10000);

  const mouvements = await prisma.mouvementStock.findMany({ where: { articleId, depotId } });
  expect(mouvements.length).toBe(1);
  expect(mouvements[0].type).toBe("ENTREE");
  expect(mouvements[0].quantite).toBe(10000);
});
