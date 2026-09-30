import { test, expect } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { creerUtilisateurAdminDeTest } from "../helpers/auth.js";

// Chantier comptes utilisateurs + rôles (remplace l'ancien identifiant/code partagé, voir
// Utilisateur/RoleUtilisateur, prisma/schema.prisma) : ce parcours vérifie que la gestion des
// comptes est bien réservée au PROPRIETAIRE (section visible côté UI, et le compte créé fonctionne
// réellement pour se connecter avec le rôle borné qui lui a été attribué).

let societeId: number;
const identifiantCuisinier = `E2E COMPTES Cuisinier ${Date.now()}`;

test.beforeAll(async () => {
  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  await creerUtilisateurAdminDeTest(societe.id);
  societeId = societe.id;
});

test.afterAll(async () => {
  await prisma.utilisateur.deleteMany({ where: { identifiant: identifiantCuisinier, societeId } });
});

test("comptes utilisateurs : un PROPRIETAIRE peut créer un compte, qui se connecte ensuite avec son rôle borné", async ({ page }) => {
  // exact: true partout ci-dessous : "Identifiant"/"Code" sont aussi des sous-chaînes de labels de
  // la page Paramètres ("Nouvel identifiant", "Code actuel") — jamais un souci tant qu'on ne
  // navigue pas déjà par Paramètres avant de vérifier la (dis)parition du formulaire de connexion,
  // ce que ce test est le premier à faire (créer un compte depuis Paramètres, puis se déconnecter).
  await page.goto("/");
  await page.getByLabel("Identifiant", { exact: true }).fill("admin");
  await page.getByLabel("Code", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant", { exact: true })).toBeHidden({ timeout: 15_000 });

  await page.goto("/parametres");
  await expect(page.getByRole("heading", { name: "Comptes utilisateurs" })).toBeVisible();

  // Page Paramètres entière : plusieurs <select> d'autres sections (Unités, TVA...) partagent le
  // même rôle "combobox" — on cible les champs de ComptesManager par id plutôt que par position.
  await page.locator("#nouveau-compte-identifiant").fill(identifiantCuisinier);
  await page.locator("#nouveau-compte-code").fill("123456");
  await page.locator("#nouveau-compte-role").selectOption({ label: "Cuisinier" });
  // "Ajouter" existe aussi sur d'autres sections de Paramètres (Catégories, Unités...) : id dédié
  // plutôt que getByRole("button", { name: "Ajouter" }), ambigu sur cette page.
  await page.locator("#nouveau-compte-ajouter").click();

  await expect(page.getByText(identifiantCuisinier)).toBeVisible();

  // Le nouveau compte fonctionne réellement, avec le rôle attribué à la création (pas de section
  // "Comptes utilisateurs" pour un CUISINIER — masquée côté UI, jamais accessible même en tapant
  // l'URL puisque server/routes/utilisateurs.ts la refuse de toute façon en 403).
  await page.getByRole("button", { name: "Déconnexion" }).click();
  await expect(page.getByLabel("Identifiant", { exact: true })).toBeVisible();

  await page.getByLabel("Identifiant", { exact: true }).fill(identifiantCuisinier);
  await page.getByLabel("Code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant", { exact: true })).toBeHidden({ timeout: 15_000 });

  await page.goto("/parametres");
  await expect(page.getByRole("heading", { name: "Comptes utilisateurs" })).toHaveCount(0);
});
