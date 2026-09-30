import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Audit backend→interface (priorité 1) : GET /haccp/evaluer/:id renvoie déjà, pour chaque étape
// détectée par mots-clés, la règle HACCP complète (risque, mesure préventive, limite critique,
// surveillance, action corrective — voir server/utils/haccp.ts), mais RecetteDetail.tsx n'en
// affichait jusque-là que le nom. Ce parcours vérifie que le détail est maintenant bien rendu,
// aussi bien pour une étape non déclarée (suggestion automatique) qu'une étape déjà marquée point
// critique par l'utilisateur.

let societeId: number;
let recetteId: number;

test.beforeAll(async () => {
  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  societeId = societe.id;

  const recette = await prisma.recette.create({
    data: {
      nom: "E2E DETAIL HACCP Recette",
      portions: 1,
      societeId,
      etapes: {
        create: [
          {
            ordre: 1,
            description: "Cuisson complète à cœur",
            pointCritiqueHACCP: false,
            controleHACCP: null,
          },
          {
            ordre: 2,
            description: "Refroidissement en cellule",
            pointCritiqueHACCP: true,
            controleHACCP: "Sonde vérifiée à chaque lot",
          },
        ],
      },
    },
  });
  recetteId = recette.id;
});

test.afterAll(async () => {
  await prisma.recetteEtape.deleteMany({ where: { recetteId } });
  await prisma.recette.delete({ where: { id: recetteId } });
});

test("fiche recette : le détail des règles HACCP détectées (risque, mesures, limites) est affiché, pas seulement leur nom", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  await page.goto("/recettes");
  await page.getByText("E2E DETAIL HACCP Recette").click();
  await expect(page.getByRole("heading", { name: "E2E DETAIL HACCP Recette" })).toBeVisible();

  // Étape 1 : suggestion automatique non déclarée (pointCritiqueHACCP=false) — la règle "Cuisson"
  // doit apparaître avec son détail complet, pas seulement son nom.
  await expect(page.getByText("🔍 Point HACCP potentiel détecté")).toBeVisible();
  const blocSuggestion = page.locator("div", { hasText: "🔍 Point HACCP potentiel détecté" }).last();
  await expect(blocSuggestion).toContainText("Survie de microorganismes"); // risque
  await expect(blocSuggestion).toContainText("Cuisson complète avec contrôle de température"); // mesure préventive
  await expect(blocSuggestion).toContainText("Prolonger la cuisson ou écarter le produit"); // action corrective

  // Étape 2 : point critique déjà déclaré par l'utilisateur — le détail de la règle détectée
  // ("Refroidissement") s'affiche en complément du contrôle qu'il a documenté.
  const blocPointCritique = page.locator("div", { hasText: "⚠ Point critique HACCP" }).last();
  await expect(blocPointCritique).toContainText("Sonde vérifiée à chaque lot");
  await expect(blocPointCritique).toContainText("Multiplication microbienne"); // risque du refroidissement
  await expect(blocPointCritique).toContainText("Refroidissement rapide en cellule"); // mesure préventive
});
