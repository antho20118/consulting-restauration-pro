import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// La barre latérale (largeur fixe 260px) restait toujours visible, y compris sur mobile : sur un
// écran étroit, elle ne laissait presque plus de place au contenu principal et forçait toute la
// page à déborder horizontalement (barre à peine visible à gauche, contenu coupé à droite — voir
// les captures d'écran ayant motivé ce correctif). Elle devient un tiroir hors écran sous 768px,
// ouvert via un bouton menu ; ce parcours vérifie l'absence de débordement horizontal et le
// fonctionnement du tiroir sur un viewport mobile réel.

test.use({ viewport: { width: 390, height: 844 } });

test.beforeAll(async () => {
  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }
});

test("mobile (390px) : pas de débordement horizontal, la barre latérale s'ouvre et se ferme via le bouton menu", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  // Aucun débordement horizontal : la largeur de scroll du document ne doit jamais dépasser la
  // largeur du viewport (une marge de 1px absorbe les arrondis de sous-pixel).
  const debordement = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(debordement).toBeLessThanOrEqual(1);

  // La barre latérale est hors écran par défaut : le translateX(-100%) qui la déplace ne change
  // pas ses dimensions ni son display (toBeVisible/toBeHidden de Playwright ne s'en aperçoivent
  // donc pas) — la classe "ouverte" ajoutée par Sidebar.tsx est le seul signal fiable de son état.
  const barreLaterale = page.locator(".app-sidebar");
  await expect(barreLaterale).not.toHaveClass(/ouverte/);

  // Le bouton menu (hamburger) l'ouvre.
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(barreLaterale).toHaveClass(/ouverte/);

  // Cliquer un lien navigue et referme le tiroir.
  await page.getByRole("link", { name: "📖 Fiches recettes" }).click();
  await expect(page).toHaveURL(/\/recettes$/);
  await expect(barreLaterale).not.toHaveClass(/ouverte/);

  const debordementApresNavigation = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(debordementApresNavigation).toBeLessThanOrEqual(1);
});
