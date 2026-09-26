import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Chantier « import photo → technique » (PHASE 17) : test navigateur réel, contre l'application
// réellement démarrée (backend + frontend Vite), parcourant le vrai chemin utilisateur avec une
// vraie photo de fiche technique (voir fixtures/fiche-technique-exemple.png, générée par rendu de
// texte réel — pas un objet JSON préparé artificiellement) :
//
//   Fiches recettes → ouvrir une recette existante → Modifier → Importer depuis une photo ou un
//   texte → Photographier → sélectionner la photo → Analyser → prévisualisation des étapes
//   extraites → décocher une étape non désirée → Appliquer à la recette → corriger le texte d'une
//   étape dans le formulaire → Enregistrer → vérification en base.
//
// Sans clé ANTHROPIC_API_KEY configurée dans cet environnement, l'analyse passe réellement par le
// repli local (OCR Tesseract + analyseRecetteLocale — voir ImporterRecetteModal.tsx), rendu
// exploitable sans dépendance à un CDN externe par le chantier de fiabilisation de l'OCR (voir
// scripts/copierAssetsTesseract.mjs). C'est donc ce chemin, réellement exécuté par un navigateur
// réel, qui est démontré ici de bout en bout.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_PHOTO = path.join(__dirname, "fixtures", "fiche-technique-exemple.png");

const NOM_RECETTE = "E2E IMPORT PHOTO Recette";
const PHOTO_ORIGINALE = "data:image/png;base64,AAAA";
const INSTRUCTIONS_ORIGINALES = "Servir immédiatement, dressage soigné.";

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
  const fournisseur = await prisma.fournisseur.create({ data: { nom: "E2E IMPORT PHOTO Fournisseur", societeId } });
  fournisseurId = fournisseur.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));

  const article = await prisma.article.create({
    data: {
      nom: "E2E IMPORT PHOTO Article",
      reference: "E2EIMPPHOTO-001",
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
      prixHT: 3.2,
      actif: true,
    },
  });

  // Recette existante COMPLÈTE : c'est précisément ce que l'import photo ne doit jamais altérer
  // (voir section 5 de la mission), hormis les techniques.
  const recette = await prisma.recette.create({
    data: {
      nom: NOM_RECETTE,
      categorieId,
      societeId,
      portions: 6,
      poidsPortionG: 200,
      prixVenteHT: 21,
      instructions: INSTRUCTIONS_ORIGINALES,
      photo: PHOTO_ORIGINALE,
      lignes: { create: [{ articleId, quantite: 300, uniteId, gainCuissonPct: 0, ordre: 0 }] },
      etapes: {
        create: [
          {
            description: "Cuire à cœur jusqu'à 68°C",
            pointCritiqueHACCP: true,
            controleHACCP: "Sonde de température, ≥68°C à cœur",
            ordre: 0,
          },
        ],
      },
    },
  });
  recetteId = recette.id;
});

test.afterAll(async () => {
  await prisma.recette.deleteMany({ where: { nom: { startsWith: "E2E IMPORT PHOTO" } } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.deleteMany({ where: { id: articleId } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
});

test("Import photo → technique : parcours utilisateur réel de bout en bout", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="text"]').first().fill("admin");
  await page.locator('input[type="password"]').first().fill("1234");
  await page.locator('button[type="submit"]').first().click();
  await expect(page.locator("text=Fiches recettes")).toBeVisible({ timeout: 10_000 });

  // 1. Fiches recettes → ouvrir la recette existante.
  await page.locator("text=Fiches recettes").first().click();
  await page.locator('input[placeholder="Rechercher..."]').fill(NOM_RECETTE);
  await page.locator(`button:has-text("${NOM_RECETTE}")`).first().click();

  // 2. Modifier.
  await page.locator('button:has-text("Modifier")').click();

  // 3. Importer une technique → Photo.
  await page.locator('button:has-text("Importer depuis une photo ou un texte")').click();
  await page.locator('button:has-text("Photographier")').click();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(CHEMIN_PHOTO);

  // Photo bien sélectionnée et affichée avant analyse (voir section 1 de la mission).
  await expect(page.locator("text=Changer la photo")).toBeVisible();

  // 4. Analyser — indicateur de progression, puis prévisualisation.
  await page.locator('button:has-text("Analyser")').click();
  await expect(page.locator("text=Analyse en cours…")).toBeVisible();
  await expect(page.locator("text=Prévisualisation de l'import")).toBeVisible({ timeout: 60_000 });

  // 5. Étapes extraites de la vraie photo, réellement affichées (pas un JSON préparé à l'avance).
  await expect(page.locator("text=Éplucher et laver les légumes")).toBeVisible();
  await expect(page.locator("text=Émincer les oignons")).toBeVisible();

  // 6. Suppression d'une étape non désirée : décocher "Ajouter le fond et cuire 45 minutes". Le
  // texte de description est désormais modifiable (textarea, voir PrevisualisationImportRecette.tsx)
  // et unique par étape ; on remonte à son ancêtre direct portant la case à cocher, pour éviter tout
  // div englobant ambigu.
  const zoneTexteEtapeADecocher = page.locator("textarea", { hasText: "Ajouter le fond et cuire 45 minutes" });
  const ligneEtapeADecocher = zoneTexteEtapeADecocher.locator("xpath=ancestor::div[input[@type='checkbox']][1]");
  await ligneEtapeADecocher.locator('input[type="checkbox"]').uncheck();

  // 7. Valider la prévisualisation.
  await page.locator('button:has-text("Appliquer à la recette")').click();

  // 8. Correction utilisateur : modifier le texte d'une étape importée, dans le formulaire.
  const texteAvantCorrection = "Faire revenir les légumes dans l'huile";
  const texteCorrige = "Faire revenir les légumes dans l'huile d'olive, à feu moyen";
  const zoneTexteEtape = page.locator("textarea").filter({ hasText: texteAvantCorrection }).first();
  await expect(zoneTexteEtape).toBeVisible({ timeout: 10_000 });
  await zoneTexteEtape.fill(texteCorrige);

  // 9. Enregistrer.
  await page.locator('button:has-text("Enregistrer")').click();
  await expect(page.locator("text=Importer depuis une photo ou un texte")).toHaveCount(0, { timeout: 10_000 });

  // 10. Vérification directe en base : même id, données préexistantes intactes, aucun doublon,
  // nouvelles étapes correctes (avec la correction utilisateur), étape décochée absente.
  const recettes = await prisma.recette.findMany({
    where: { nom: NOM_RECETTE },
    include: { lignes: true, etapes: { orderBy: { ordre: "asc" } } },
  });
  expect(recettes.length).toBe(1);
  const recette = recettes[0];
  expect(recette.id).toBe(recetteId);
  expect(recette.portions).toBe(6);
  expect(recette.poidsPortionG).toBe(200);
  expect(recette.prixVenteHT).toBe(21);
  expect(recette.instructions).toBe(INSTRUCTIONS_ORIGINALES);
  expect(recette.photo).toBe(PHOTO_ORIGINALE);
  expect(recette.lignes).toHaveLength(1);
  expect(recette.lignes[0].articleId).toBe(articleId);
  expect(recette.lignes[0].quantite).toBe(300);

  const descriptions = recette.etapes.map((e) => e.description);
  expect(descriptions).toContain("Cuire à cœur jusqu'à 68°C");
  expect(descriptions).toContain("Éplucher et laver les légumes.");
  expect(descriptions).toContain("Émincer les oignons.");
  expect(descriptions).toContain(texteCorrige);
  expect(descriptions.some((d) => d.includes("Ajouter le fond"))).toBe(false);
  expect(descriptions.some((d) => d === "Faire revenir les légumes dans l'huile.")).toBe(false);

  const etapeHaccp = recette.etapes.find((e) => e.description === "Cuire à cœur jusqu'à 68°C");
  expect(etapeHaccp?.pointCritiqueHACCP).toBe(true);
  expect(etapeHaccp?.controleHACCP).toBe("Sonde de température, ≥68°C à cœur");
});
