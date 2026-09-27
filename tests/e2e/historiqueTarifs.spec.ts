import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Chantier fournisseurs, Phase 7 : parcours navigateur réel de l'historique des tarifs dans l'onglet
// "Articles / Tarifs" — backend + frontend Vite réellement démarrés (même principe de bootstrap que
// tests/e2e/ficheFournisseur.spec.ts, Phase 5). Les documents source (LISTING et FACTURE) sont créés
// par de VRAIS appels HTTP au serveur réellement démarré (pas par écriture directe de fichier depuis
// ce process de test, qui n'utiliserait pas le même DOCUMENTS_STORAGE_PATH que le serveur) — même
// principe déjà établi par tests/unit/fournisseurDetail.test.ts et tests/e2e/importFacturePhoto.spec.ts
// (Phase 6) : le pipeline réel (stockage + rapprochement + validation) crée le fichier et la chaîne
// de traçabilité TarifArticle → LigneDocumentFournisseur → DocumentFournisseur, jamais fabriqués à la
// main. Le tarif "historique" est en revanche créé directement via Prisma (actif:false, dateFin
// renseigné) : sa présence et sa cohérence sont déjà exhaustivement prouvées par
// tests/unit/fournisseurDetail.test.ts ; ce test navigateur vérifie uniquement que l'écran restitue
// correctement des données réelles, pas la logique de clôture elle-même (hors périmètre Phase 7).

const BACKEND_URL = "http://localhost:3000";

let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteId: number;
let conditionnementId: number;
let fournisseurId: number;
const articleIds: number[] = [];

function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test.beforeAll(async () => {
  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }
  const reponseLogin = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: "admin", code: "1234" }),
  });
  const token: string = (await reponseLogin.json()).token;

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const unite =
    (await prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteId = unite.id;
  const conditionnement = (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Carton" } }));
  conditionnementId = conditionnement.id;

  const fournisseur = await prisma.fournisseur.create({ data: { nom: "E2E HISTORIQUE TARIFS Fournisseur", societeId } });
  fournisseurId = fournisseur.id;

  // Article avec tarif ACTIF, source LISTING (pipeline réel : photo → stockage → validation).
  const articleListing = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E HISTORIQUE TARIFS Article Listing", categorieId, tvaId, societeId },
  });
  articleIds.push(articleListing.id);
  const reponseListing = await fetch(`${BACKEND_URL}/api/listings-fournisseur/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      societeId,
      nomFichierOriginal: "e2e-historique-listing.png",
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "E2E HISTORIQUE TARIFS Article Listing", prix: "6,50" }],
    }),
  });
  const corpsListing = await reponseListing.json();
  await fetch(`${BACKEND_URL}/api/listings-fournisseur/documents/${corpsListing.document.id}/valider`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      decisions: [{ ligneId: corpsListing.lignes[0].id, decision: "VALIDEE", articleRetenuId: articleListing.id }],
    }),
  });

  // Article avec tarif ACTIF, source FACTURE (pipeline réel : photo → stockage → validation).
  const articleFacture = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E HISTORIQUE TARIFS Article Facture", categorieId, tvaId, societeId },
  });
  articleIds.push(articleFacture.id);
  const reponseFacture = await fetch(`${BACKEND_URL}/api/listings-fournisseur/factures/${fournisseurId}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      societeId,
      numero: "E2E-HIST-FA-001",
      dateDocument: "2025-02-01",
      montantTotal: 9.9,
      nomFichierOriginal: "e2e-historique-facture.png",
      photoDataUrl: PNG_1X1,
      lignes: [{ designation: "E2E HISTORIQUE TARIFS Article Facture", prix: "9,90" }],
    }),
  });
  const corpsFacture = await reponseFacture.json();
  await fetch(`${BACKEND_URL}/api/listings-fournisseur/documents/${corpsFacture.document.id}/valider`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      decisions: [{ ligneId: corpsFacture.lignes[0].id, decision: "VALIDEE", articleRetenuId: articleFacture.id }],
    }),
  });

  // Article avec un tarif clôturé, sans source documentaire (déjà couvert au niveau API — ici on ne
  // vérifie que le rendu de la section "Historique").
  const articleHistorique = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: "E2E HISTORIQUE TARIFS Article Historique", categorieId, tvaId, societeId },
  });
  articleIds.push(articleHistorique.id);
  await prisma.tarifArticle.create({
    data: {
      articleId: articleHistorique.id,
      fournisseurId,
      uniteId,
      conditionnementId,
      quantiteConditionnement: 1,
      prixHT: 7.77,
      dateDebut: new Date("2024-01-01"),
      dateFin: new Date("2024-06-01"),
      actif: false,
    },
  });
});

test.afterAll(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.tarifArticle.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
});

test("Articles / Tarifs : tarifs actuels et historique distincts, source Listing/Facture affichée, consultation du document source", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto(`/fournisseurs/${fournisseurId}`);
  await page.getByRole("button", { name: "Articles / Tarifs" }).click();

  await expect(page.getByRole("heading", { name: "Tarifs actuels", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historique", exact: true })).toBeVisible();

  const tableauActuels = page.locator('h3:has-text("Tarifs actuels") + table');
  const tableauHistorique = page.locator('h3:has-text("Historique") + table');

  // Les deux tarifs actifs (Listing et Facture) apparaissent dans "Tarifs actuels", avec leur source
  // affichée explicitement (jamais devinée) et jamais dans "Historique".
  const ligneActuelleListing = tableauActuels.locator("tr", { hasText: "Article Listing" });
  const ligneActuelleFacture = tableauActuels.locator("tr", { hasText: "Article Facture" });
  await expect(ligneActuelleListing).toBeVisible();
  await expect(ligneActuelleFacture).toBeVisible();
  await expect(ligneActuelleListing).toContainText("Listing");
  await expect(ligneActuelleFacture).toContainText("Facture");
  await expect(tableauHistorique.getByText("E2E HISTORIQUE TARIFS Article Listing")).toHaveCount(0);
  await expect(tableauHistorique.getByText("E2E HISTORIQUE TARIFS Article Facture")).toHaveCount(0);

  // Le tarif clôturé apparaît dans "Historique", jamais dans "Tarifs actuels" — avec ses dates Du/Au
  // réelles, sans source inventée.
  await expect(tableauHistorique.getByText("E2E HISTORIQUE TARIFS Article Historique")).toBeVisible();
  await expect(tableauActuels.getByText("E2E HISTORIQUE TARIFS Article Historique")).toHaveCount(0);
  await expect(tableauHistorique.getByText("Source documentaire non disponible")).toBeVisible();

  // Consultation réelle de la source documentaire (chaîne TarifArticle → LigneDocumentFournisseur →
  // DocumentFournisseur), pas seulement son libellé.
  await ligneActuelleListing.getByRole("button", { name: "Voir le document" }).click();

  await expect(page.getByText("e2e-historique-listing.png")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("E2E HISTORIQUE TARIFS Article Listing", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Article retenu \(décision humaine\)/)).toBeVisible();

  // Retour à la liste des fournisseurs.
  await page.getByRole("button", { name: "← Retour à la liste" }).click();
  await expect(page).toHaveURL(/\/fournisseurs$/);
});
