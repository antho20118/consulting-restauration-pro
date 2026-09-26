import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";
import { calculerCoutRecette, inclusionsRecette } from "../../server/utils/coutRecette.js";

// Chantier « import photo : rendu professionnel » — démontre dans un navigateur réel, contre
// l'application réellement démarrée, la correction du défaut structurel identifié par l'audit :
// une photo dont le texte reconnu contient une ligne à ingrédients multiples séparés par une
// virgule (« 100 g de sucre, 50 g de beurre ») et un en-tête décoratif de mise en page
// (« — Ingrédients — ») ne doit plus produire une seule ligne d'ingrédient au nom-phrase, ni une
// fausse étape parasite — voir tests/e2e/fixtures/fiche-ingredients-multiples.png (texte réellement
// rendu, pas un JSON préparé à l'avance) et
// src/features/recettes/utils/{analyseRecetteLocale,normaliserExtraction}.ts.
//
//   Fiches recettes → Importer une recette → Photographier → sélectionner la photo → Analyser →
//   prévisualisation (2 ingrédients bien séparés, aucune ligne parasite parmi les techniques) →
//   Créer la recette → formulaire pré-rempli (articles déjà rapprochés automatiquement, comme pour
//   tout import) → Enregistrer → vérification en base (2 lignes, 2 étapes, coût calculé depuis les
//   tarifs réels des deux articles).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_PHOTO = path.join(__dirname, "fixtures", "fiche-ingredients-multiples.png");

const NOM_RECETTE = "E2E NORMALISATION Quatre-quarts";

test.describe.configure({ mode: "serial" });

let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteGramme: number;
let articleSucreId: number;
let articleBeurreId: number;
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
  uniteGramme = unite.id;
  const fournisseur = await prisma.fournisseur.create({ data: { nom: "E2E NORMALISATION Fournisseur", societeId } });
  fournisseurId = fournisseur.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));

  // Deux articles déjà existants dans le catalogue, sous des noms contenant ceux extraits de la
  // photo (« sucre », « beurre ») : un tarif réel est associé à chacun, pour vérifier que le coût
  // final provient bien de ces tarifs et non d'une donnée inventée par l'extraction (voir section
  // coûts de la mission). Le rapprochement automatique (voir trouverArticle dans ligneImportee.ts)
  // les associe dès l'analyse, sans qu'aucune recherche manuelle ne soit nécessaire dans ce test.
  async function creerArticleAvecTarif(nom: string, reference: string, prixHT: number) {
    const article = await prisma.article.create({
      data: { nom, reference, categorieId, tvaId, societeId, rendement: 100, type: "MATIERE_PREMIERE" },
    });
    await prisma.tarifArticle.create({
      data: {
        articleId: article.id,
        fournisseurId,
        uniteId: uniteGramme,
        conditionnementId: conditionnement.id,
        quantiteConditionnement: 1000,
        prixHT,
        actif: true,
      },
    });
    return article.id;
  }

  articleSucreId = await creerArticleAvecTarif("E2E NORMALISATION sucre", "E2ENORM-SUCRE-001", 2);
  articleBeurreId = await creerArticleAvecTarif("E2E NORMALISATION beurre", "E2ENORM-BEURRE-001", 6);
});

test.afterAll(async () => {
  await prisma.recette.deleteMany({ where: { nom: NOM_RECETTE } });
  // L'enregistrement mémorise un alias ingrédient → article (voir enregistrerAliasIngredients dans
  // RecetteForm.tsx, comportement normal de l'appli, pas spécifique à ce test) : à retirer avant de
  // pouvoir supprimer les articles de test eux-mêmes.
  await prisma.aliasIngredientImport.deleteMany({
    where: { articleId: { in: [articleSucreId, articleBeurreId] } },
  });
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: [articleSucreId, articleBeurreId] } } });
  await prisma.article.deleteMany({ where: { id: { in: [articleSucreId, articleBeurreId] } } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
});

test("Import photo → normalisation : ingrédients multiples séparés, aucune ligne parasite, coût réel", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('input[type="text"]').first().fill("admin");
  await page.locator('input[type="password"]').first().fill("1234");
  await page.locator('button[type="submit"]').first().click();
  await expect(page.locator("text=Fiches recettes")).toBeVisible({ timeout: 10_000 });
  await page.locator("text=Fiches recettes").first().click();

  // Le filtre "Ne proposer que les articles Super U" (actif par défaut, voir filtreFournisseur.ts)
  // exclurait le rapprochement automatique des articles de test ci-dessus, dont le fournisseur
  // n'est pas Super U — désactivé ici via la préférence normalement exposée dans le formulaire de
  // recette, jamais un contournement du mécanisme lui-même.
  await page.evaluate(() => localStorage.setItem("consulting_filtre_super_u", "non"));

  // 1. Nouvelle recette depuis une photo (pas de complétion d'une recette existante).
  await page.getByRole("button", { name: "Importer une recette", exact: true }).click();
  await page.locator('button:has-text("Photographier")').click();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(CHEMIN_PHOTO);
  await expect(page.locator("text=Changer la photo")).toBeVisible();

  // 2. Analyser.
  await page.locator('button:has-text("Analyser")').click();
  await expect(page.locator("text=Prévisualisation de l'import")).toBeVisible({ timeout: 60_000 });

  // 3. L'en-tête décoratif « — Ingrédients — » n'est jamais devenu une ligne parasite : exactement
  // 2 ingrédients réellement extraits de la photo, bien séparés (jamais un nom-phrase fusionné
  // contenant une seconde quantité, comme c'était le cas avant la correction).
  await expect(page.locator("h3", { hasText: "Ingrédients (2)" })).toBeVisible();
  await expect(page.locator("text=Nom extrait : sucre")).toBeVisible();
  await expect(page.locator("text=Nom extrait : beurre")).toBeVisible();

  // 4. Exactement 2 techniques réelles, aucune ligne parasite (l'en-tête ne devient jamais une
  // fausse étape « Ingrédients »).
  await expect(page.locator("h3", { hasText: "Techniques (2)" })).toBeVisible();
  await expect(page.locator("text=Mélanger le beurre et le sucre")).toBeVisible();
  await expect(page.locator("text=Ajouter la farine")).toBeVisible();
  await expect(page.locator("li", { hasText: "Ingrédients" })).toHaveCount(0);

  // 5. Créer la recette à partir de cet import → formulaire pré-rempli, les deux articles déjà
  // rapprochés automatiquement (comme n'importe quel import, jamais de rapprochement manuel requis
  // pour que l'enregistrement soit possible : seule sa CONFIRMATION reste à la charge de
  // l'utilisateur avant un usage réel — hors du périmètre de ce test, qui vérifie la structure).
  await page.locator('button:has-text("Créer la recette à partir de cet import")').click();
  await expect(page.locator('button:has-text("Enregistrer")')).toBeVisible({ timeout: 10_000 });

  // 6. Enregistrer.
  await page.locator('button:has-text("Enregistrer")').click();
  await expect(page.locator('button:has-text("Enregistrer")')).toHaveCount(0, { timeout: 10_000 });

  // 7. Vérification directe en base : structure propre, coût calculé depuis les tarifs réels.
  const recette = await prisma.recette.findFirst({
    where: { nom: NOM_RECETTE },
    include: { lignes: true, etapes: { orderBy: { ordre: "asc" } } },
  });
  expect(recette).not.toBeNull();
  expect(recette!.lignes).toHaveLength(2);
  expect(recette!.etapes).toHaveLength(2);
  expect(recette!.etapes[0].description).toBe("Mélanger le beurre et le sucre");
  expect(recette!.etapes[1].description).toBe("Ajouter la farine");
  expect(recette!.etapes.some((e) => /ingrédients/i.test(e.description))).toBe(false);

  const ligneSucre = recette!.lignes.find((l) => l.articleId === articleSucreId);
  const ligneBeurre = recette!.lignes.find((l) => l.articleId === articleBeurreId);
  expect(ligneSucre).toBeDefined();
  expect(ligneSucre!.quantite).toBe(100);
  expect(ligneBeurre).toBeDefined();
  expect(ligneBeurre!.quantite).toBe(50);

  // 8. Coût recalculé (même fonction que la route GET /recettes/:id) depuis les tarifs réels
  // (2 €/kg sucre, 6 €/kg beurre) : jamais une donnée financière extraite de la photo (l'extraction
  // n'en produit d'ailleurs aucune).
  const recetteComplete = await prisma.recette.findUniqueOrThrow({
    where: { id: recette!.id },
    include: inclusionsRecette,
  });
  const coutAttendu = (100 / 1000) * 2 + (50 / 1000) * 6;
  expect(calculerCoutRecette(recetteComplete).coutTotal).toBeCloseTo(coutAttendu, 5);
});
