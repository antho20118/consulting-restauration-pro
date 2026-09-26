import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Chantier « import photo → technique » (PHASE 17), volet protection des données existantes
// (section 5/6 de la mission) : vérifie de bout en bout, contre une app Express réelle et un vrai
// Postgres, que la complétion d'une recette déjà complète par de nouvelles techniques importées
// (voir server/routes/recettes.ts::PUT /:id, appliquée par
// src/features/recettes/components/RecetteForm.tsx::appliquerImport après validation de la
// prévisualisation — voir PrevisualisationImportRecette.tsx) :
//   - conserve exactement le même recetteId (jamais de création d'une seconde recette) ;
//   - conserve à l'identique tous les champs déjà renseignés (ingrédients, HACCP existant, notes,
//     photo, catégorie, portions, prix de vente...) qu'une analyse photo ne concerne pas ;
//   - n'ajoute que les nouvelles étapes, sans jamais supprimer ni modifier les étapes existantes ;
//   - enregistre fidèlement une étape corrigée manuellement par l'utilisateur dans la
//     prévisualisation (jamais une version non corrigée).
//
// Ce test exerce le vrai chemin d'écriture (PUT /recettes/:id) avec un payload équivalent à celui
// que produirait RecetteForm.tsx après validation d'une prévisualisation d'import (voir son
// commentaire dédié) — la génération de ce payload à partir d'une photo elle-même (IA ou OCR local)
// est couverte séparément : tests/unit/analyseRecetteLocale.test.ts (structuration),
// tests/unit/recettesImportIA.test.ts (route d'analyse), et le test navigateur réel (Playwright,
// tests/e2e/) pour le parcours UI complet.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteId: number;
let fournisseurId: number;
let conditionnementId: number;
let articleId: number;

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function creer(chemin: string, corps: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}${chemin}`, { method: "POST", headers: authHeaders(), body: JSON.stringify(corps) });
  return { status: reponse.status, corps: await reponse.json().catch(() => null) };
}

async function mettreAJour(chemin: string, corps: Record<string, unknown>) {
  const reponse = await fetch(`${baseUrl}${chemin}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(corps) });
  return { status: reponse.status, corps: await reponse.json().catch(() => null) };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  const accesExistant = await prisma.accesApplication.findFirst();
  if (!accesExistant) {
    await prisma.accesApplication.create({ data: { identifiant: "admin", codeHache: hacherCode("1234") } });
  }
  const reponseLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant: "admin", code: "1234" }),
  });
  assert.equal(reponseLogin.status, 200);
  token = (await reponseLogin.json()).token;

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
  const fournisseur = await prisma.fournisseur.create({ data: { nom: "IMPORT PHOTO TEST Fournisseur", societeId } });
  fournisseurId = fournisseur.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));
  conditionnementId = conditionnement.id;

  const article = await prisma.article.create({
    data: {
      nom: "IMPORT PHOTO TEST Article",
      reference: "IMPPHOTOTEST-001",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      type: "MATIERE_PREMIERE",
    },
  });
  articleId = article.id;
  await prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId, conditionnementId, quantiteConditionnement: 1, prixHT: 4.5, actif: true },
  });
});

after(async () => {
  await prisma.recette.deleteMany({ where: { nom: { startsWith: "IMPORT PHOTO TEST" } } });
  await prisma.tarifArticle.deleteMany({ where: { articleId } });
  await prisma.article.deleteMany({ where: { id: articleId } });
  await prisma.fournisseur.deleteMany({ where: { id: fournisseurId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("Import photo → technique : ajout d'étapes préserve intégralement une recette existante complète (ingrédients, HACCP, notes, photo, autres champs), même id, aucun doublon", async () => {
  const photoOriginale = "data:image/png;base64,AAAA";
  const instructionsOriginales = "Servir bien chaud, accompagné d'un vin rouge léger.";

  // 1. Recette existante complète : ingrédients, portions, poids, prix, notes, photo, et une étape
  // HACCP déjà en place (voir section 5 de la mission : tout ce qu'une analyse photo de technique
  // ne concerne pas doit être conservé intact).
  const creation = await creer("/api/recettes", {
    nom: "IMPORT PHOTO TEST Recette",
    categorieId,
    societeId,
    portions: 4,
    poidsPortionG: 220,
    poidsAccompagnementG: 80,
    prixVenteHT: 18.5,
    instructions: instructionsOriginales,
    photo: photoOriginale,
    lignes: [{ articleId, quantite: 500, uniteId, gainCuissonPct: 0 }],
    etapes: [
      {
        description: "Cuire à cœur jusqu'à 68°C",
        pointCritiqueHACCP: true,
        controleHACCP: "Sonde de température, ≥68°C à cœur",
      },
    ],
  });
  assert.equal(creation.status, 201);
  const recetteId: number = creation.corps.id;

  const avantNombreRecettes = await prisma.recette.count();

  // 2. Simule le patch produit par la prévisualisation d'un import photo (voir
  // PrevisualisationImportRecette.tsx::valider, mode complétion) : seules des étapes sont
  // AJOUTÉES à celles déjà existantes, avec une étape corrigée manuellement par l'utilisateur
  // avant validation (voir section 4 de la mission : le texte doit rester modifiable) — tous les
  // autres champs sont repris strictement identiques à l'état actuel de la recette, comme le fait
  // RecetteForm.tsx::appliquerImport pour tout champ qu'aucun patch n'a explicitement ciblé.
  const etapesTechniquesCorrigeesParUtilisateur = [
    { description: "Éplucher et laver soigneusement les légumes", pointCritiqueHACCP: false, controleHACCP: null },
    { description: "Émincer finement les oignons (texte corrigé après relecture)", pointCritiqueHACCP: false, controleHACCP: null },
  ];

  const miseAJour = await mettreAJour(`/api/recettes/${recetteId}`, {
    nom: creation.corps.nom,
    categorieId: creation.corps.categorieId,
    sousCategorieId: creation.corps.sousCategorieId,
    portions: creation.corps.portions,
    poidsPortionG: creation.corps.poidsPortionG,
    poidsAccompagnementG: creation.corps.poidsAccompagnementG,
    prixVenteHT: creation.corps.prixVenteHT,
    instructions: creation.corps.instructions,
    photo: creation.corps.photo,
    lignes: creation.corps.lignes.map((l: { articleId: number; quantite: number; uniteId: number; gainCuissonPct: number }) => ({
      articleId: l.articleId,
      quantite: l.quantite,
      uniteId: l.uniteId,
      gainCuissonPct: l.gainCuissonPct,
    })),
    etapes: [
      ...creation.corps.etapes.map((e: { description: string; pointCritiqueHACCP: boolean; controleHACCP: string | null }) => ({
        description: e.description,
        pointCritiqueHACCP: e.pointCritiqueHACCP,
        controleHACCP: e.controleHACCP,
      })),
      ...etapesTechniquesCorrigeesParUtilisateur,
    ],
  });
  assert.equal(miseAJour.status, 200);

  // 3. Même recetteId, jamais une seconde recette créée.
  assert.equal(miseAJour.corps.id, recetteId);
  const apresNombreRecettes = await prisma.recette.count();
  assert.equal(apresNombreRecettes, avantNombreRecettes, "aucun doublon : le nombre total de recettes ne doit pas changer");
  const recettesAvecCeNom = await prisma.recette.count({ where: { nom: "IMPORT PHOTO TEST Recette" } });
  assert.equal(recettesAvecCeNom, 1, "une seule recette ne doit porter ce nom");

  // 4. Tous les autres champs métier strictement préservés.
  assert.equal(miseAJour.corps.nom, "IMPORT PHOTO TEST Recette");
  assert.equal(miseAJour.corps.categorieId, categorieId);
  assert.equal(miseAJour.corps.portions, 4);
  assert.equal(miseAJour.corps.poidsPortionG, 220);
  assert.equal(miseAJour.corps.poidsAccompagnementG, 80);
  assert.equal(miseAJour.corps.prixVenteHT, 18.5);
  assert.equal(miseAJour.corps.instructions, instructionsOriginales);
  assert.equal(miseAJour.corps.photo, photoOriginale);
  assert.equal(miseAJour.corps.lignes.length, 1);
  assert.equal(miseAJour.corps.lignes[0].articleId, articleId);
  assert.equal(miseAJour.corps.lignes[0].quantite, 500);

  // 5. L'étape HACCP existante reste identique (retrouvée par sa description, l'id change car
  // PUT /recettes/:id remplace intégralement la table RecetteLigne/RecetteEtape — voir son
  // commentaire dans server/routes/recettes.ts — mais le CONTENU doit être bit-à-bit identique).
  const etapeHaccpConservee = miseAJour.corps.etapes.find((e: { description: string }) =>
    e.description === "Cuire à cœur jusqu'à 68°C"
  );
  assert.ok(etapeHaccpConservee, "l'étape HACCP déjà existante doit toujours être présente");
  assert.equal(etapeHaccpConservee.pointCritiqueHACCP, true);
  assert.equal(etapeHaccpConservee.controleHACCP, "Sonde de température, ≥68°C à cœur");

  // 6. Les nouvelles étapes sont bien présentes, avec le texte CORRIGÉ par l'utilisateur (jamais
  // une version non corrigée qui aurait été produite par une extraction automatique brute).
  const etapeCorrigee = miseAJour.corps.etapes.find((e: { description: string }) =>
    e.description === "Émincer finement les oignons (texte corrigé après relecture)"
  );
  assert.ok(etapeCorrigee, "l'étape corrigée manuellement par l'utilisateur doit être celle enregistrée");
  const etapeNonCorrigeeAbsente = miseAJour.corps.etapes.find((e: { description: string }) =>
    e.description === "Émincer les oignons"
  );
  assert.equal(etapeNonCorrigeeAbsente, undefined, "la version non corrigée ne doit jamais apparaître");

  assert.equal(miseAJour.corps.etapes.length, 3, "1 étape déjà existante + 2 étapes importées, jamais de perte ni de doublon d'étape");
});
