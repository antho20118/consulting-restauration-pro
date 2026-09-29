import { test, expect, type Page } from "@playwright/test";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Audit mobile complet (au-delà de la barre latérale, déjà couverte par
// menuMobileResponsive.spec.ts) : plusieurs familles de débordement horizontal repérées sur des
// captures d'écran mobiles réelles (dont un retour utilisateur direct : "je suis obligé de le
// mettre à l'horizontal" sur la page Fiches recettes).
// 1. Formulaires en popup à largeur fixe (ex. IngredientForm.tsx, width: 450) dont le fond
//    (position: fixed, inset: 0, padding horizontal nul) ne limitait pas leur largeur — sur un
//    viewport étroit, la carte débordait sans qu'aucun défilement ne soit proposé, rendant le
//    formulaire partiellement inatteignable. Corrigé par maxWidth: calc(100vw - 32px) +
//    boxSizing: border-box sur chaque popup concernée.
// 2. Tableaux <table> sans wrapper de défilement (ex. HaccpPage.tsx) : corrigé en les enveloppant
//    dans <div style={{ overflowX: "auto" }}>, comme déjà pratiqué ailleurs (FournisseurDetailPage,
//    TarifsGroupeFournisseurs).
// 3. Groupes de boutons/champs imbriqués sans flexWrap (RecettesPage.tsx : 6 boutons d'import +
//    filtre sous-catégorie ; FournisseursPage.tsx : case à cocher + recherche ; les 5 gestionnaires
//    de ParametresPage.tsx : champ flex:1 sans minWidth:0 + boutons Renommer/Supprimer) — l'ajout
//    de flexWrap au conteneur EXTÉRIEUR d'un toolbar (première vague de ce chantier) ne suffit pas
//    si un conteneur INTÉRIEUR (le groupe de boutons lui-même) n'a pas aussi flexWrap : le groupe
//    entier déborde alors comme un seul bloc, invisible pour un simple flexWrap sur le parent.
//
// Piège méthodologique important : `document.documentElement.scrollWidth -
// document.documentElement.clientWidth` (utilisé par menuMobileResponsive.spec.ts) est neutralisé
// par la règle `.app-layout { overflow-x: hidden }` sous 768px (index.css) — elle masque le
// débordement au lieu de le corriger, donc ce calcul renvoie ~0 même quand des boutons réels sont
// physiquement inatteignables. `elementsDebordants` ci-dessous détecte le vrai problème : tout
// élément dont le bord droit dépasse le viewport, sauf s'il est sous un ancêtre à défilement
// horizontal volontaire (overflowX: auto/scroll — ex. un tableau enveloppé, ou une grille MUI
// DataGrid qui gère son propre défilement interne, vérifié séparément comme non concerné).

test.use({ viewport: { width: 390, height: 844 } });

test.beforeAll(async () => {
  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }
});

async function elementsDebordants(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const resultats: string[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= vw + 2) return;
      if (getComputedStyle(el).visibility === "hidden") return;

      let ancetre: Element | null = el.parentElement;
      while (ancetre) {
        // MUI DataGrid gère son propre défilement horizontal interne (vérifié séparément :
        // .MuiDataGrid-virtualScroller a bien overflowX: scroll et un scrollWidth réel supérieur
        // à sa largeur visible) — ses cellules d'en-tête virtualisées ont des rects bruts plus
        // larges que le viewport par construction, sans que ce soit atteignable au clavier/à la
        // souris qui en soit affecté : ignoré ici plutôt que suivi sur une profondeur arbitraire.
        if (ancetre.className && String(ancetre.className).includes("MuiDataGrid")) return;
        const overflowX = getComputedStyle(ancetre).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return;
        ancetre = ancetre.parentElement;
      }

      resultats.push(
        `${el.tagName} right:${rect.right.toFixed(0)} text:"${(el.textContent || "").slice(0, 40).replace(/\s+/g, " ")}"`
      );
    });
    return resultats;
  });
}

async function ouvrirPageDepuisMenuMobile(page: Page, lien: string) {
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("link", { name: lien }).click();
}

test("mobile (390px) : Ingrédients, HACCP, Fiches recettes, Fournisseurs et Paramètres ne débordent jamais horizontalement", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Code").fill("1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Identifiant")).toBeHidden({ timeout: 15_000 });

  // Page Ingrédients : toolbar (boutons + champ de recherche à largeur fixe) sans flexWrap
  // provoquait un débordement — vérifié avant toute autre interaction.
  await ouvrirPageDepuisMenuMobile(page, "🥕 Base ingrédients");
  await expect(page).toHaveURL(/\/ingredients$/);
  await expect(page.getByRole("button", { name: "+ Nouvel ingrédient" })).toBeVisible({ timeout: 20_000 });
  expect(await elementsDebordants(page)).toEqual([]);

  // Popup IngredientForm (largeur fixe 450px) : ne doit plus déborder, et son bouton
  // "Enregistrer" (le plus à droite du formulaire) doit rester entièrement dans le viewport.
  await page.getByRole("button", { name: "+ Nouvel ingrédient" }).click();
  const boutonEnregistrer = page.getByRole("button", { name: "Enregistrer" });
  await expect(boutonEnregistrer).toBeVisible();
  expect(await elementsDebordants(page)).toEqual([]);

  const boiteBouton = await boutonEnregistrer.boundingBox();
  expect(boiteBouton).not.toBeNull();
  expect(boiteBouton!.x + boiteBouton!.width).toBeLessThanOrEqual(390 + 1);

  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(boutonEnregistrer).toBeHidden();

  // Page HACCP : les tableaux (risque, mesure préventive…) sont enveloppés dans un conteneur à
  // défilement horizontal propre, sans faire déborder la page elle-même.
  await ouvrirPageDepuisMenuMobile(page, "🛡️ HACCP");
  await expect(page).toHaveURL(/\/haccp$/);
  await expect(page.getByRole("heading", { name: "⚠ Cuisson" })).toBeVisible({ timeout: 20_000 });
  expect(await elementsDebordants(page)).toEqual([]);

  // Page Fiches recettes : le groupe de 6 boutons d'import ET le filtre sous-catégorie +
  // recherche sont deux conteneurs flex IMBRIQUÉS dans le toolbar externe déjà corrigé — chacun
  // avait besoin de son propre flexWrap (signalement utilisateur direct : forcé de passer en
  // paysage sur cette page précise).
  await ouvrirPageDepuisMenuMobile(page, "📖 Fiches recettes");
  await expect(page).toHaveURL(/\/recettes$/);
  await expect(page.getByRole("button", { name: "+ Nouvelle recette" })).toBeVisible({ timeout: 20_000 });
  expect(await elementsDebordants(page)).toEqual([]);

  // Page Fournisseurs : case "Afficher aussi les fournisseurs désactivés" + recherche, même
  // groupe interne sans flexWrap.
  await ouvrirPageDepuisMenuMobile(page, "🚚 Fournisseurs");
  await expect(page).toHaveURL(/\/fournisseurs$/);
  await expect(page.getByRole("button", { name: "+ Nouveau fournisseur" })).toBeVisible({ timeout: 20_000 });
  expect(await elementsDebordants(page)).toEqual([]);

  // Page Paramètres : les 5 gestionnaires (Catégories ingrédients/recettes, Sous-catégories,
  // Unités, TVA) partagent le même motif — une ligne par élément avec un champ flex:1 (sans
  // minWidth:0, donc jamais réellement rétréci) suivi de boutons Renommer/Supprimer à largeur
  // fixe, sans flexWrap.
  await ouvrirPageDepuisMenuMobile(page, "⚙ Paramètres");
  await expect(page).toHaveURL(/\/parametres$/);
  await expect(page.getByRole("heading", { name: "TVA" })).toBeVisible({ timeout: 20_000 });
  expect(await elementsDebordants(page)).toEqual([]);
});
