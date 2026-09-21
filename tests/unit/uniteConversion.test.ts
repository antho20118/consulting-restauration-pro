import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { versUniteBase } from "../../server/utils/uniteConversion.js";
import { calculerCoutRecette } from "../../server/utils/coutRecette.js";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";

// Teste server/utils/uniteConversion.ts, la source unique de la règle
// « quantite * facteurBase », introduite en PR #56 pour remplacer les quatre implémentations
// locales dupliquées de cette même règle (coutRecette.ts, planifierProduction.ts,
// suggestionsEconomie.ts, achats.ts) — l'une d'elles avait été oubliée dans planifierProduction.ts
// (voir PR #55), produisant un besoinNet et un quantiteProduction faux d'un facteur facteurBase.
//
// Deux niveaux de test :
// - [1] à [8] : tests unitaires purs de versUniteBase() (aucune base de données nécessaire).
// - [9] à [11] : scénarios réels de bout en bout (vraie app Express, vrai PostgreSQL configuré par
//   DATABASE_URL) prouvant que le helper centralisé est bien celui utilisé par les trois modules
//   appelants, avec les mêmes valeurs numériques que les audits précédents (PR #50, #55).
// - [12] : vérifie explicitement qu'aucune conversion n'est appliquée deux fois.

test("[1] 1 kg → 1000 g (facteurBase=1000, base du poids = g)", () => {
  assert.equal(versUniteBase(1, { facteurBase: 1000 }), 1000);
});

test("[2] 500 g → 500 g (facteurBase=1, déjà en unité de base)", () => {
  assert.equal(versUniteBase(500, { facteurBase: 1 }), 500);
});

test("[3] 1 L → 1000 mL (facteurBase=1000, base du volume = mL)", () => {
  // Même arithmétique que [1] (facteurBase=1000) : versUniteBase ne connaît pas la famille
  // d'unité (poids/volume/pièce), seul le facteurBase compte — d'où un résultat identique. Testé
  // séparément malgré tout, car demandé explicitement comme cas distinct (litre/mL, pas kg/g).
  assert.equal(versUniteBase(1, { facteurBase: 1000 }), 1000);
});

test("[4] 250 mL → 250 mL (facteurBase=1, déjà en unité de base)", () => {
  assert.equal(versUniteBase(250, { facteurBase: 1 }), 250);
});

test("[5] pièce → pièce (facteurBase=1, unité déjà discrète/de base)", () => {
  assert.equal(versUniteBase(4, { facteurBase: 1 }), 4);
});

test("[6] boîte → boîte (facteurBase=1, même principe que pièce)", () => {
  assert.equal(versUniteBase(2, { facteurBase: 1 }), 2);
});

test("[7] quantité invalide : rejette négatif, NaN et Infinity", () => {
  assert.throws(() => versUniteBase(-1, { facteurBase: 1000 }), /Quantité invalide/);
  assert.throws(() => versUniteBase(NaN, { facteurBase: 1000 }), /Quantité invalide/);
  assert.throws(() => versUniteBase(Infinity, { facteurBase: 1000 }), /Quantité invalide/);
  // Une quantité nulle reste valide (ex. ligne de recette pas encore renseignée) : seul le négatif
  // et le non-fini sont rejetés — comportement identique à l'ancienne validation de coutRecette.ts.
  assert.equal(versUniteBase(0, { facteurBase: 1000 }), 0);
});

test("[8] facteur invalide : rejette zéro, négatif, NaN et Infinity", () => {
  assert.throws(() => versUniteBase(1, { facteurBase: 0 }), /Facteur d'unité invalide/);
  assert.throws(() => versUniteBase(1, { facteurBase: -1000 }), /Facteur d'unité invalide/);
  assert.throws(() => versUniteBase(1, { facteurBase: NaN }), /Facteur d'unité invalide/);
  assert.throws(() => versUniteBase(1, { facteurBase: Infinity }), /Facteur d'unité invalide/);
});

test("[8bis] verrouille l'API : le second paramètre doit être un objet { facteurBase }, un nombre brut n'est plus accepté (suite à l'audit de conception de PR #56)", () => {
  assert.throws(() => {
    // @ts-expect-error — un nombre brut ne doit plus être assignable au second paramètre de
    // versUniteBase. Si cette directive devient superflue (« Unused '@ts-expect-error'
    // directive »), c'est que la signature a régressé vers l'ancienne forme
    // number | { facteurBase }, que l'audit de conception a explicitement demandé de retirer :
    // le typecheck échoue alors sur cette ligne, verrouillant l'API à chaque build.
    //
    // La directive supprime seulement l'erreur de compilation, pas l'exécution : l'appel a bien
    // lieu à l'exécution du test, mais échoue quand même au niveau runtime, puisqu'un nombre brut
    // n'a pas de propriété .facteurBase (donc undefined, rejeté par la validation). Double
    // verrouillage : au typecheck et à l'exécution.
    versUniteBase(1, 1000);
  }, /Facteur d'unité invalide/);
});

test("[9] scénario recette réel : calculerCoutRecette() utilise bien versUniteBase() pour chaque ligne, avec des unités mixtes (g et kg)", () => {
  // Recette à 2 lignes d'unités différentes, rendement 100%, sans gain de cuisson : le poids fini
  // total doit être la somme des quantités converties en unité de base (grammes), pas des
  // quantités brutes — 200 (déjà en g) + 500*1000 (0,5kg en g) = 200 + 500000... non : la ligne kg
  // vaut ici 0.5 kg de quantité, soit 500g en base. Poids fini attendu = 200 + 500 = 700g.
  const recette = {
    portions: 1,
    prixVenteHT: null,
    lignes: [
      {
        quantite: 200,
        unite: { facteurBase: 1 }, // grammes
        gainCuissonPct: 0,
        article: { rendement: 100, tarifs: [], allergenes: [] },
      },
      {
        quantite: 0.5,
        unite: { facteurBase: 1000 }, // kilogrammes
        gainCuissonPct: 0,
        article: { rendement: 100, tarifs: [], allergenes: [] },
      },
    ],
  };

  const resultat = calculerCoutRecette(recette);

  assert.equal(resultat.poidsFiniTotalG, 700, "200g + 0,5kg (500g en base) = 700g, via versUniteBase pour chaque ligne");
  // [12] absence de double conversion : la ligne retournée expose toujours la quantité brute
  // d'origine (0.5), jamais la valeur déjà convertie (500) — sinon un appelant qui reconvertirait
  // cette valeur (ex. planifierProduction.ts) appliquerait le facteurBase une seconde fois.
  assert.equal(resultat.lignes[1].quantite, 0.5, "la ligne retournée ne doit jamais exposer une quantité déjà convertie");
});

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let conditionnementId: number;
let uniteKgId: number;
let depotId: number;
let articleId: number;
let tarifId: number;
const recetteIds: number[] = [];

async function creerRecette(body: unknown): Promise<{ id: number }> {
  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const texte = await reponse.text();
  assert.equal(reponse.status, 201, `Création de recette échouée : ${texte}`);
  const recette = JSON.parse(texte);
  recetteIds.push(recette.id);
  return recette;
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
  assert.equal(reponseLogin.status, 200, "Connexion admin/1234 impossible");
  token = (await reponseLogin.json()).token;

  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst()) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test" } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  const fournisseur =
    (await prisma.fournisseur.findFirst()) ?? (await prisma.fournisseur.create({ data: { nom: "Fournisseur de test", societeId } }));
  fournisseurId = fournisseur.id;
  const conditionnement =
    (await prisma.conditionnement.findFirst()) ?? (await prisma.conditionnement.create({ data: { nom: "Unité" } }));
  conditionnementId = conditionnement.id;
  const uniteKg =
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }));
  uniteKgId = uniteKg.id;
  const depot = (await prisma.depot.findFirst({ where: { societeId } })) ?? (await prisma.depot.create({ data: { nom: "Dépôt de test", societeId } }));
  depotId = depot.id;

  const article = await prisma.article.create({
    data: {
      nom: "UNITECONV TEST POULET (kg)",
      reference: "UNITECONV-KG",
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      actif: true,
    },
  });
  articleId = article.id;

  const tarif = await prisma.tarifArticle.create({
    data: {
      articleId,
      fournisseurId,
      uniteId: uniteKgId,
      conditionnementId,
      quantiteConditionnement: 5,
      prixHT: 50,
      actif: true,
      dateDebut: new Date(),
    },
  });
  tarifId = tarif.id;
});

after(async () => {
  await prisma.stock.deleteMany({ where: { articleId } });
  await prisma.recetteLigne.deleteMany({ where: { recetteId: { in: recetteIds } } });
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  await prisma.tarifArticle.deleteMany({ where: { id: tarifId } });
  await prisma.article.deleteMany({ where: { id: articleId } });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("[9bis] scénario recette réel via HTTP : GET /api/recettes/:id calcule un coût cohérent avec versUniteBase (1kg à 10€/kg de coût unitaire)", async () => {
  // Tarif : carton de 5kg à 50€ => 10€/kg => 0,01€/g. Ligne de recette : 1kg. Coût attendu :
  // 1000g (converti par versUniteBase) x 0,01€/g = 10€.
  const recette = await creerRecette({
    societeId,
    nom: "UNITECONV TEST RECETTE COUT REEL",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [],
  });

  const reponse = await fetch(`${baseUrl}/api/recettes/${recette.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.coutTotal, 10, "1kg converti en 1000g x 0,01€/g = 10€");
  assert.equal(resultat.poidsFiniTotalG, 1000, "1kg converti en 1000g via versUniteBase");
});

test("[10] scénario production réel : POST /api/production/planifier utilise versUniteBase (1kg/portion x 4 portions, cible 40 portions, stock 3kg)", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "UNITECONV TEST RECETTE PRODUCTION REEL",
    categorieId: null,
    sousCategorieId: null,
    portions: 4,
    lignes: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [],
  });
  await prisma.stock.create({ data: { articleId, depotId, quantite: 3000 } });

  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, depotId, cible: { mode: "portions", valeur: 40 } }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.lignes[0].quantiteProduction, 10000, "quantiteProduction doit rester correcte après centralisation (non-régression PR #55)");
  assert.equal(resultat.lignes[0].besoinNet, 7000, "besoinNet doit rester correct après centralisation (non-régression PR #55)");

  await prisma.stock.deleteMany({ where: { articleId, depotId } });
});

test("[11] scénario production → achats réel : le besoinNet centralisé (7000g) produit la même proposition d'achat qu'avant (2 conditionnements de 5kg, 10000g, 100€ HT)", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "UNITECONV TEST RECETTE ACHATS REEL",
    categorieId: null,
    sousCategorieId: null,
    portions: 4,
    lignes: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [],
  });
  await prisma.stock.create({ data: { articleId, depotId, quantite: 3000 } });

  const reponseProd = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, depotId, cible: { mode: "portions", valeur: 40 } }),
  });
  assert.equal(reponseProd.status, 200);
  const resultatProd = await reponseProd.json();
  assert.equal(resultatProd.lignes[0].besoinNet, 7000);

  // besoinNet est déjà en unité de base : facteurUniteRecette=1 (aucune conversion supplémentaire
  // à appliquer côté achats — voir [12] ci-dessous).
  const reponseAchats = await fetch(`${baseUrl}/api/achats/proposition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      besoins: [{ articleId, quantite: resultatProd.lignes[0].besoinNet, facteurUniteRecette: 1 }],
    }),
  });
  assert.equal(reponseAchats.status, 200);
  const resultatAchats = await reponseAchats.json();
  const ligneAchat = resultatAchats.lignes[0];

  assert.equal(ligneAchat.besoinBase, 7000, "versUniteBase(7000, { facteurBase: 1 }) = 7000 : aucune conversion supplémentaire");
  assert.equal(ligneAchat.conditionnements, 2);
  assert.equal(ligneAchat.quantiteCommandeeBase, 10000);
  assert.equal(ligneAchat.coutCommandeHT, 100);

  await prisma.stock.deleteMany({ where: { articleId, depotId } });
});

test("[12] absence de double conversion : un facteurBase=1000 appliqué deux fois donnerait 10x plus que la valeur attendue — vérifie que ce n'est pas le cas", async () => {
  // Preuve directe et indépendante des valeurs numériques ci-dessus : si versUniteBase était
  // appliqué deux fois quelque part dans la chaîne recette -> production, quantiteProduction
  // vaudrait 1000 x 1000 x 10 = 10 000 000 au lieu de 10 000 (facteur 1000 en trop, pas juste x10,
  // car chaque application multiplie par le facteurBase entier). On vérifie ici la valeur exacte
  // à un facteur 1000 près dans les deux sens pour rendre l'erreur de double conversion impossible
  // à manquer si elle était réintroduite.
  const recette = await creerRecette({
    societeId,
    nom: "UNITECONV TEST DOUBLE CONVERSION",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId, quantite: 1, uniteId: uniteKgId, gainCuissonPct: 0 }],
    etapes: [],
  });

  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, cible: { mode: "portions", valeur: 1 } }),
  });
  assert.equal(reponse.status, 200);
  const resultat = await reponse.json();

  assert.equal(resultat.lignes[0].quantiteProduction, 1000, "1kg converti une seule fois = 1000g (pas 1000000, ce que donnerait une double conversion)");
  assert.notEqual(resultat.lignes[0].quantiteProduction, 1000 * 1000, "détecterait une double application de facteurBase");
});
