import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Chantier factures fournisseurs, Phase 6 (option C — déduplication graduée) : parcours navigateur
// réel (backend + frontend Vite réellement démarrés, vraie photo rendue par Chromium puis relue par
// l'OCR local Tesseract, vrai Postgres) — même principe que tests/e2e/importListingPhoto.spec.ts
// (Phase 4). Sans ANTHROPIC_API_KEY (vérifié absente dans cet environnement), le parcours passe
// réellement par le repli OCR local (analyserFactureLocal.ts).
//
// Le numéro/la date/le montant sont saisis explicitement via les champs modifiables de l'étape 2
// (voir ImportFacturePhotoModal.tsx) plutôt que laissés à la seule reconnaissance OCR : la photo ne
// contient qu'une ligne produit, comme la fixture du Phase 4 — l'OCR de chiffres/symboles isolés
// (numéro, date) n'est pas fiable à 100% en conditions réelles, et le parcours de décision complet
// (choix d'article, application) reste, comme le Phase 4/5, hors du périmètre de ce test navigateur
// (couvert de façon exhaustive et déterministe par tests/unit/facturesFournisseur.test.ts, sur vrai
// Postgres) : ce test se concentre sur ce qu'un test HTTP ne peut pas prouver — le rendu réel, la
// saisie réelle, l'alerte de doublon réellement affichée à l'écran, et la décision humaine réelle.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHEMIN_PHOTO = path.join(__dirname, "fixtures", "facture-fournisseur-exemple.png");

let societeId: number;
let fournisseurId: number;

test.beforeAll(async () => {
  const navigateur = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await navigateur.newPage({ viewport: { width: 700, height: 200 } });
  await page.setContent(`
    <html><body style="font-family: Arial; font-size: 28px; padding: 20px; background: white;">
      <div>EMMENTAL RAPE SACHET 1KG 6,90</div>
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

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "E2E FACTURE PHOTO Fournisseur", societeId } });
  fournisseurId = fournisseur.id;
});

test.afterAll(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
  await fs.rm(CHEMIN_PHOTO, { force: true });
});

test("import facture par photo : première import réel, puis alerte de doublon forte à la ré-importation, confirmation humaine tracée", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto(`/fournisseurs/${fournisseurId}`);
  await page.getByRole("button", { name: "Factures" }).click();
  await expect(page.getByText("Aucune facture importée pour l'instant.")).toBeVisible();

  // --- Premier import : aucune facture existante, aucune alerte attendue ---
  await page.getByRole("button", { name: "Importer une facture par photo" }).click();
  await expect(page.getByText("Importer une facture fournisseur par photo")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(CHEMIN_PHOTO);
  await expect(page.locator('label:has-text("Changer la photo")')).toBeVisible();
  await page.getByRole("button", { name: "Analyser" }).click();

  await expect(page.getByText(/ligne\(s\) reconnue\(s\)/)).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Numéro").fill("FA-9001");
  await page.getByLabel("Date").fill("2026-03-15");
  await page.getByLabel("Montant total (€)").fill("6.90");

  await page.getByRole("button", { name: "Continuer" }).click();

  // Aucune alerte de doublon ne doit apparaître pour ce premier import : passage direct à l'étape
  // de décision (une ligne, "rejeter cette ligne" visible, comme le Phase 4/5).
  await expect(page.getByText(/rejeter cette ligne/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/doublon potentiel|correspondance forte/i)).toHaveCount(0);

  const documentsApresPremierImport = await prisma.documentFournisseur.findMany({ where: { fournisseurId } });
  expect(documentsApresPremierImport.length).toBe(1);
  expect(documentsApresPremierImport[0].type).toBe("FACTURE");
  expect(documentsApresPremierImport[0].numero).toBe("FA-9001");
  expect(documentsApresPremierImport[0].montantTotal).toBe(6.9);
  expect(documentsApresPremierImport[0].cle).toMatch(/^[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Annuler" }).click();

  // --- Deuxième import : même numéro + même date + même montant -> correspondance FORTE ---
  await page.getByRole("button", { name: "Importer une facture par photo" }).click();
  await page.locator('input[type="file"]').setInputFiles(CHEMIN_PHOTO);
  await expect(page.locator('label:has-text("Changer la photo")')).toBeVisible();
  await page.getByRole("button", { name: "Analyser" }).click();
  await expect(page.getByText(/ligne\(s\) reconnue\(s\)/)).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Numéro").fill("FA-9001");
  await page.getByLabel("Date").fill("2026-03-15");
  await page.getByLabel("Montant total (€)").fill("6.90");

  await page.getByRole("button", { name: "Continuer" }).click();

  // L'alerte doit distinguer explicitement le niveau FORTE (règle 15 du cadrage) sans jamais
  // bloquer l'utilisateur (le bouton de confirmation reste disponible).
  await expect(page.getByText(/correspondance forte/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/purement informative/i)).toBeVisible();

  // Purement informatif : aucune deuxième facture ne doit encore exister avant confirmation.
  expect(await prisma.documentFournisseur.count({ where: { fournisseurId } })).toBe(1);

  await page.getByRole("button", { name: "Confirmer l'import quand même" }).click();

  // La décision humaine a réellement eu lieu : l'import a désormais lieu (étape de décision
  // atteinte), et la trace de cette confirmation est la coexistence des deux documents en base
  // (règle 9/10 du cadrage : aucun champ d'identité inventé, aucune migration).
  await expect(page.getByText(/rejeter cette ligne/i).first()).toBeVisible({ timeout: 15_000 });

  const documentsApresConfirmation = await prisma.documentFournisseur.findMany({
    where: { fournisseurId },
    orderBy: { id: "asc" },
  });
  expect(documentsApresConfirmation.length).toBe(2);
  expect(documentsApresConfirmation[0].numero).toBe("FA-9001");
  expect(documentsApresConfirmation[1].numero).toBe("FA-9001");
  expect(documentsApresConfirmation[0].id).not.toBe(documentsApresConfirmation[1].id);
});
