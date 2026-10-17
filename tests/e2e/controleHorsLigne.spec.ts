import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Point 9 de l'audit du 15/10 — parcours réel d'un contrôle HACCP saisi sans réseau : mis en
// attente sur l'appareil, envoyé au retour du réseau, enregistré UNE fois et daté du moment de la
// saisie (pas de la synchronisation), l'heure de réception restant visible. La logique serveur est
// couverte par tests/unit/horsLigneHorodatageDoublons.test.ts ; ici, la chaîne côté téléphone
// (src/offline/actionsProduction.ts, synchronisation.ts).

const ATTENTE_HORS_LIGNE_MS = 5_000;
let recetteId: number;
let productionId: number;

test.beforeAll(async () => {
  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  const recette = await prisma.recette.create({
    data: {
      nom: "E2E HORS LIGNE Recette",
      portions: 1,
      societeId: societe.id,
      etapes: { create: [{ ordre: 1, description: "E2E HORS LIGNE cuisson", pointCritiqueHACCP: true, controleHACCP: "≥ 63 °C" }] },
    },
  });
  recetteId = recette.id;
  productionId = (
    await prisma.production.create({ data: { recetteId, societeId: societe.id, portionsProduites: 1, poidsFiniProduitG: 0 } })
  ).id;
});

test.afterAll(async () => {
  await prisma.controleHACCPProduction.deleteMany({ where: { productionId } });
  await prisma.production.deleteMany({ where: { id: productionId } });
  await prisma.recetteEtape.deleteMany({ where: { recetteId } });
  await prisma.recette.deleteMany({ where: { id: recetteId } });
});

test("contrôle saisi sans réseau : envoyé au retour du réseau, une seule fois, daté de la saisie", async ({ page, context }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto(`/productions/${productionId}`);
  await expect(page.getByRole("heading", { name: /E2E HORS LIGNE Recette/ })).toBeVisible({ timeout: 15_000 });

  await context.setOffline(true);
  await page.getByPlaceholder("Valeur constatée (ex. 72°C)").fill("71 °C");
  const saisie = Date.now();
  await page.getByRole("button", { name: "Enregistrer le contrôle" }).click();
  await expect(page.getByText("En attente de synchronisation", { exact: true })).toBeVisible();
  // La mise en file relance un rechargement de la production, qui échoue sans réseau : l'écran doit
  // rester affiché (production et contrôle en attente), jamais remplacé par l'erreur réseau.
  await page.waitForTimeout(1_500);
  await expect(page.getByRole("heading", { name: /E2E HORS LIGNE Recette/ })).toBeVisible();
  await expect(page.getByText("En attente de synchronisation", { exact: true })).toBeVisible();
  expect(await prisma.controleHACCPProduction.count({ where: { productionId } })).toBe(0);

  // Le réseau revient plus tard : la synchronisation part d'elle-même (événement « online »).
  await page.waitForTimeout(ATTENTE_HORS_LIGNE_MS);
  await context.setOffline(false);
  await expect.poll(() => prisma.controleHACCPProduction.count({ where: { productionId } }), { timeout: 15_000 }).toBe(1);

  const [controle] = await prisma.controleHACCPProduction.findMany({ where: { productionId } });
  expect(controle.valeur).toBe("71 °C");
  expect(Math.abs(controle.dateHeure.getTime() - saisie)).toBeLessThan(2_000);
  expect(controle.createdAt.getTime() - controle.dateHeure.getTime()).toBeGreaterThan(ATTENTE_HORS_LIGNE_MS - 1_000);
  expect(controle.cleIdempotence).not.toBeNull();

  // Une nouvelle synchronisation (rechargement de l'application) ne renvoie rien de plus.
  await page.reload();
  await expect(page.getByText("71 °C")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_000);
  expect(await prisma.controleHACCPProduction.count({ where: { productionId } })).toBe(1);
});
