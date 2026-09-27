import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Chantier listings/factures fournisseurs, Phase 4 : test navigateur réel (backend + frontend Vite
// réellement démarrés), avec une vraie photo générée par rendu HTML réel (capture d'écran d'une
// page affichant le texte du listing, pas un fichier JSON ni un pixel unique) — même principe que
// tests/e2e/importPhotoTechnique.spec.ts. Sans ANTHROPIC_API_KEY (vérifié absente dans cet
// environnement), le parcours passe réellement par le repli OCR local + analyseListingLocal.ts.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_PHOTO = path.join(__dirname, "fixtures", "listing-fournisseur-exemple.png");

let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let articleId: number;

test.beforeAll(async () => {
  // Génère une vraie image (capture d'écran d'une page réellement rendue par Chromium), plutôt
  // qu'un pixel unique ou un fichier fabriqué à la main : le texte doit être réellement lisible par
  // l'OCR Tesseract exécuté ensuite côté client dans le test lui-même.
  const navigateur = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await navigateur.newPage({ viewport: { width: 700, height: 300 } });
  await page.setContent(`
    <html><body style="font-family: Arial; font-size: 28px; padding: 20px; background: white;">
      <div>EMMENTAL RAPE SACHET 1KG 6,90</div>
      <div>FARINE T55 SAC 25KG 18,50</div>
      <div>FRAIS DE LIVRAISON 12,00</div>
    </body></html>
  `);
  await page.screenshot({ path: CHEMIN_PHOTO });
  await navigateur.close();

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
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  const conditionnement = (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Sac" } }));

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "E2E LISTING PHOTO Fournisseur", societeId } });
  fournisseurId = fournisseur.id;

  // Article déjà existant portant une désignation proche de la première ligne du listing, pour que
  // le rapprochement en trouve une correspondance approximative réelle pendant le test.
  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E LISTING PHOTO Emmental Rape", categorieId, tvaId, societeId },
  });
  articleId = article.id;
  await prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId: uniteKg.id, conditionnementId: conditionnement.id, quantiteConditionnement: 1, prixHT: 5 },
  });
});

test.afterAll(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.delete({ where: { id: articleId } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
  await fs.rm(CHEMIN_PHOTO, { force: true });
});

test("import listing par photo : sélection fournisseur, photo, analyse OCR locale, aperçu, décision", async ({ page }) => {
  await page.goto("/");

  // Attend réellement l'écran de connexion (auto-wait Playwright) plutôt qu'un isVisible()
  // ponctuel, qui pourrait s'exécuter avant le premier rendu et sauter silencieusement la
  // connexion — page.goto vers /ingredients recharge entièrement l'app (SPA sans routeur
  // conditionnant l'accès par URL, voir App.tsx), donc un jeton absent du localStorage y réaffiche
  // simplement l'écran de connexion, quelle que soit l'URL demandée.
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  // Le texte du bouton change transitoirement ("Connexion...") pendant la requête : attendre la
  // disparition du champ Identifiant est un signal fiable que LoginPage a bien été démonté (voir
  // App.tsx, bascule connecte/AppRoutes), contrairement au bouton dont le nom accessible change.
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto("/ingredients");
  await page.getByRole("button", { name: "Importer un listing par photo" }).click();

  await expect(page.getByText("Importer un listing fournisseur par photo")).toBeVisible();

  await page.locator("select").first().selectOption({ label: "E2E LISTING PHOTO Fournisseur" });
  await page.locator('input[type="file"]').setInputFiles(CHEMIN_PHOTO);

  await expect(page.locator('label:has-text("Changer la photo")')).toBeVisible();

  await page.getByRole("button", { name: "Analyser" }).click();

  // Sans clé IA, le repli OCR + analyseListingLocal doit produire au moins une ligne exploitable
  // (le texte de la fixture a été rendu réellement lisible, 28px, contraste net).
  await expect(page.getByText(/ligne\(s\) reconnue\(s\)/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Continuer" }).click();

  // Persistance réelle : le document doit maintenant exister en base avec son fichier associé.
  await expect(page.getByText(/rejeter cette ligne/i).first()).toBeVisible({ timeout: 15_000 });

  const document = await prisma.documentFournisseur.findFirstOrThrow({ where: { fournisseurId } });
  expect(document.type).toBe("LISTING");
  expect(document.cle).toMatch(/^[0-9a-f-]{36}$/);

  const lignes = await prisma.ligneDocumentFournisseur.findMany({ where: { documentId: document.id } });
  expect(lignes.length).toBeGreaterThan(0);
});
