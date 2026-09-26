import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Chantier « import photo → technique », second point d'entrée : contrairement à
// tests/e2e/importPhotoTechnique.spec.ts (qui passe par une recette déjà ouverte en édition,
// RecetteForm.tsx), ce test parcourt le point d'entrée depuis la LISTE des recettes
// (RecettesPage.tsx → bouton "Importer des techniques (fichier)" → mode Photo,
// ImporterTechniquesFichierModal.tsx) : aucune recette n'est ouverte au préalable, la recette
// cible est choisie explicitement dans un sélecteur avant l'analyse.
//
//   Fiches recettes → Importer des techniques (fichier) → Photo → choisir la recette cible →
//   sélectionner la photo → Analyser → prévisualisation → corriger le texte d'une étape →
//   Appliquer à la recette → vérification en base (même id, aucune recette créée, données
//   préexistantes intactes, nouvelles étapes correctes).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_PHOTO = path.join(__dirname, "fixtures", "fiche-technique-exemple.png");

const NOM_RECETTE = "E2E LISTE IMPORT PHOTO Recette";
const PHOTO_ORIGINALE = "data:image/png;base64,BBBB";
const INSTRUCTIONS_ORIGINALES = "Dresser sur assiette chaude.";

test.describe.configure({ mode: "serial" });

let recetteId: number;
let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteId: number;
let articleId: number;
let fournisseurId: number;

test.beforeAll(async () => {
  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const unite =
    (await prisma.unite.findFirst({ where: { symbole: "g" } })) ??
    (await prisma.unite.create({ data: { nom: "Gramme", symbole: "g", type: "poids", facteurBase: 1 } }));
  uniteId = unite.id;
  const fournisseur = await prisma.fournisseur.create({ data: { nom: "E2E LISTE IMPORT PHOTO Fournisseur", societeId } });
  fournisseurId = fournisseur.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));

  const article = await prisma.article.create({
    data: {
      nom: "E2E LISTE IMPORT PHOTO Article",
      reference: "E2ELISTEIMPPHOTO-001",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      type: "MATIERE_PREMIERE",
    },
  });
  articleId = article.id;
  await prisma.tarifArticle.create({
    data: {
      articleId,
      fournisseurId,
      uniteId,
      conditionnementId: conditionnement.id,
      quantiteConditionnement: 1,
      prixHT: 2.8,
      actif: true,
    },
  });

  const recette = await prisma.recette.create({
    data: {
      nom: NOM_RECETTE,
      categorieId,
      societeId,
      portions: 8,
      poidsPortionG: 180,
      prixVenteHT: 15,
      instructions: INSTRUCTIONS_ORIGINALES,
      photo: PHOTO_ORIGINALE,
      lignes: { create: [{ articleId, quantite: 400, uniteId, gainCuissonPct: 0, ordre: 0 }] },
      etapes: {
        create: [
          {
            description: "Refroidir rapidement après cuisson",
            pointCritiqueHACCP: true,
            controleHACCP: "Refroidissement à 10°C en moins de 2h",
            ordre: 0,
          },
        ],
      },
    },
  });
  recetteId = recette.id;
});

test.afterAll(async () => {
  await prisma.recette.deleteMany({ where: { nom: { startsWith: "E2E LISTE IMPORT PHOTO" } } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.deleteMany({ where: { id: articleId } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
});

test("Import photo → technique depuis la liste des recettes (sans recette déjà ouverte)", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="text"]').first().fill("admin");
  await page.locator('input[type="password"]').first().fill("1234");
  await page.locator('button[type="submit"]').first().click();
  await expect(page.locator("text=Fiches recettes")).toBeVisible({ timeout: 10_000 });
  await page.locator("text=Fiches recettes").first().click();

  // 1. Aucune recette ouverte : directement depuis la liste, bouton "Importer des techniques (fichier)".
  await page.locator('button:has-text("Importer des techniques (fichier)")').click();
  await expect(page.locator("h2", { hasText: "Importer des techniques" })).toBeVisible();

  // 2. Choisir le mode Photo (le mode Fichier reste le mode par défaut, intact). Correspondance
  // exacte : le nom de la recette de test contient lui-même le mot "PHOTO".
  await page.getByRole("button", { name: "Photo", exact: true }).click();

  // 3. Choisir explicitement la recette cible (pas de nom de feuille à rapprocher pour une photo).
  await page.locator("select").filter({ hasText: "choisir une recette" }).selectOption({ label: NOM_RECETTE });

  // 4. Sélectionner la vraie photo.
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(CHEMIN_PHOTO);
  await expect(page.locator("text=Changer la photo")).toBeVisible();

  // 5. Analyser.
  await page.locator('button:has-text("Analyser")').click();
  await expect(page.locator("text=Analyse en cours…")).toBeVisible();
  // Le titre de la prévisualisation confirme la recette cible choisie (correspondance exacte :
  // "text=" seul est ambigu, ce nom apparaissant aussi dans la liste et dans le message de patch).
  await expect(page.locator("h2", { hasText: "Prévisualisation de l'import" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("h2", { hasText: "Prévisualisation de l'import" })).toContainText(NOM_RECETTE);

  // 6. Étapes réellement extraites de la vraie photo.
  await expect(page.locator("textarea").filter({ hasText: "Éplucher et laver les légumes" })).toBeVisible();

  // 7. Correction du texte d'une étape DIRECTEMENT dans la prévisualisation (pas de formulaire ici).
  const texteCorrige = "Émincer très finement les oignons nouveaux";
  const zoneTexteEtape = page.locator("textarea").filter({ hasText: "Émincer les oignons" }).first();
  await zoneTexteEtape.fill(texteCorrige);

  // 8. Décocher une étape non désirée.
  const paragrapheEtape = page.locator("textarea", { hasText: "Ajouter le fond et cuire 45 minutes" });
  const ligneEtapeADecocher = paragrapheEtape.locator("xpath=ancestor::div[input[@type='checkbox']][1]");
  await ligneEtapeADecocher.locator('input[type="checkbox"]').uncheck();

  // 9. Valider — application directe par API (pas de formulaire intermédiaire à enregistrer).
  await page.locator('button:has-text("Appliquer à la recette")').click();
  await expect(page.locator("text=Prévisualisation de l'import")).toHaveCount(0, { timeout: 10_000 });

  // 10. Vérification directe en base.
  const recettes = await prisma.recette.findMany({
    where: { nom: NOM_RECETTE },
    include: { lignes: true, etapes: { orderBy: { ordre: "asc" } } },
  });
  expect(recettes.length).toBe(1);
  const recette = recettes[0];
  expect(recette.id).toBe(recetteId);
  expect(recette.portions).toBe(8);
  expect(recette.poidsPortionG).toBe(180);
  expect(recette.prixVenteHT).toBe(15);
  expect(recette.instructions).toBe(INSTRUCTIONS_ORIGINALES);
  expect(recette.photo).toBe(PHOTO_ORIGINALE);
  expect(recette.lignes).toHaveLength(1);
  expect(recette.lignes[0].articleId).toBe(articleId);
  expect(recette.lignes[0].quantite).toBe(400);

  const descriptions = recette.etapes.map((e) => e.description);
  expect(descriptions).toContain("Refroidir rapidement après cuisson");
  expect(descriptions).toContain("Éplucher et laver les légumes.");
  expect(descriptions).toContain(texteCorrige);
  expect(descriptions.some((d) => d.includes("Ajouter le fond"))).toBe(false);
  expect(descriptions.some((d) => d === "Émincer les oignons.")).toBe(false);

  const etapeHaccp = recette.etapes.find((e) => e.description === "Refroidir rapidement après cuisson");
  expect(etapeHaccp?.pointCritiqueHACCP).toBe(true);
  expect(etapeHaccp?.controleHACCP).toBe("Refroidissement à 10°C en moins de 2h");
});
