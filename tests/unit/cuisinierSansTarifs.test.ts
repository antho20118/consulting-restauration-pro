import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";
import { texteDuPdf } from "../helpers/pdf.js";

// Point 7 de l'audit du 15/10 — décision : « Les cuisiniers ne doivent voir aucun tarif. Les tarifs
// ne doivent pas apparaître. » Jusqu'ici la lecture (GET) était ouverte à tous les rôles : un
// CUISINIER voyait prix d'achat, coûts de revient, prix de vente, marges, commandes et ventes.
//
// Vérifié côté serveur, pas seulement masqué à l'écran : des montants « témoins » (introuvables
// ailleurs) sont posés sur un tarif, une recette, un menu et la société, puis chaque réponse lue par
// un CUISINIER est fouillée, à la recherche de ces montants comme d'un champ de prix. Le même
// parcours en CHEF (témoin) doit, lui, les voir — sans quoi le test ne prouverait rien.

const PRIX_ACHAT = 43.219; // €/kg
const PRIX_VENTE_RECETTE = 87.65;
const PRIX_VENTE_MENU = 76.54;
const COEFFICIENT = 3.217;
const TEMOINS = ["43.219", "21.6095", "87.65", "76.54", "3.217"];
// Un tarif sans montant (unité d'achat, fournisseur) n'est pas un prix : l'écran des mouvements de
// stock en a besoin pour proposer la bonne unité. Seuls les montants et leurs dérivés sont visés.
const CHAMP_DE_PRIX = /^(prix|cout|marge|foodCost|montant|economie|chiffreAffaires|valeurStock|coefficientMultiplicateur)/i;

let server: Server;
let baseUrl: string;
let societeId: number;
let jetonCuisinier: string;
let jetonChef: string;
let articleId: number;
let recetteId: number;
let menuId: number;
let depotId: number;
let productionId: number;
const marqueur = `CUISINIER-TARIFS-${randomUUID()}`;

async function connecter(identifiant: string): Promise<string> {
  const reponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, code: "1234" }),
  });
  return ((await reponse.json()) as { token: string }).token;
}

function appel(jeton: string, method: string, chemin: string, body?: unknown) {
  return fetch(`${baseUrl}/api${chemin}`, {
    method,
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function champsDePrix(valeur: unknown, chemin = "", trouves: string[] = []): string[] {
  if (Array.isArray(valeur)) {
    valeur.forEach((element, index) => champsDePrix(element, `${chemin}[${index}]`, trouves));
  } else if (valeur && typeof valeur === "object") {
    for (const [cle, sous] of Object.entries(valeur)) {
      if (CHAMP_DE_PRIX.test(cle)) trouves.push(`${chemin}.${cle}`);
      champsDePrix(sous, `${chemin}.${cle}`, trouves);
    }
  }
  return trouves;
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

  societeId = (await prisma.societe.create({ data: { nom: marqueur, coefficientMultiplicateur: COEFFICIENT } })).id;
  for (const role of ["CUISINIER", "CHEF"] as const) {
    await prisma.utilisateur.create({
      data: { identifiant: `${marqueur}-${role}`, codeHache: hacherCode("1234"), role, societeId },
    });
  }
  jetonCuisinier = await connecter(`${marqueur}-CUISINIER`);
  jetonChef = await connecter(`${marqueur}-CHEF`);

  const categorieId = (await prisma.categorie.create({ data: { nom: marqueur, societeId } })).id;
  const tvaId = (await prisma.tVA.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
  const fournisseurId = (
    await prisma.fournisseur.create({ data: { nom: marqueur, societeId, codeFournisseur: "FOU-TEST" } })
  ).id;
  const conditionnementId = (
    (await prisma.conditionnement.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.conditionnement.create({ data: { nom: "Unité" } }))
  ).id;
  const kgId = (
    (await prisma.unite.findFirst({ where: { symbole: "kg" } })) ??
    (await prisma.unite.create({ data: { nom: "Kilogramme", symbole: "kg", type: "poids", facteurBase: 1000 } }))
  ).id;
  articleId = (
    await prisma.article.create({ data: { nom: `${marqueur} carottes`, type: "MATIERE_PREMIERE", categorieId, tvaId, societeId } })
  ).id;
  await prisma.tarifArticle.create({
    data: { articleId, fournisseurId, uniteId: kgId, conditionnementId, quantiteConditionnement: 1, prixHT: PRIX_ACHAT, actif: true },
  });
  depotId = (await prisma.depot.create({ data: { nom: marqueur, societeId } })).id;
  await prisma.stock.create({ data: { articleId, depotId, quantite: 5000 } });
  await prisma.mouvementStock.create({ data: { articleId, depotId, type: "ENTREE", quantite: 5000, motif: "Réception" } });
  recetteId = (
    await prisma.recette.create({
      data: {
        nom: `${marqueur} purée`,
        societeId,
        portions: 2,
        prixVenteHT: PRIX_VENTE_RECETTE,
        lignes: { create: [{ articleId, quantite: 1, uniteId: kgId }] },
        etapes: { create: [{ ordre: 1, description: "Cuire.", pointCritiqueHACCP: false }] },
      },
    })
  ).id;
  menuId = (
    await prisma.menu.create({
      data: { nom: `${marqueur} menu`, societeId, prixVenteHT: PRIX_VENTE_MENU, lignes: { create: [{ recetteId, quantite: 1 }] } },
    })
  ).id;
});

after(async () => {
  try {
    await prisma.controleHACCPProduction.deleteMany({ where: { production: { societeId } } });
    await prisma.mouvementStock.deleteMany({ where: { depotId } });
    await prisma.production.deleteMany({ where: { societeId } });
    await prisma.stock.deleteMany({ where: { depotId } });
    await prisma.menu.deleteMany({ where: { societeId } });
    await prisma.recetteEtape.deleteMany({ where: { recette: { societeId } } });
    await prisma.recetteLigne.deleteMany({ where: { recette: { societeId } } });
    await prisma.recette.deleteMany({ where: { societeId } });
    await prisma.tarifArticle.deleteMany({ where: { articleId } });
    await prisma.article.deleteMany({ where: { societeId } });
    await prisma.depot.deleteMany({ where: { societeId } });
    await prisma.fournisseur.deleteMany({ where: { societeId } });
    await prisma.categorie.deleteMany({ where: { societeId } });
    await prisma.utilisateur.deleteMany({ where: { societeId } });
    await prisma.societe.deleteMany({ where: { id: societeId } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

// Écrans de gestion entièrement fermés au cuisinier (achats, fournisseurs, ventes, analyses).
const ROUTES_FERMEES: [string, string, unknown?][] = [
  ["GET", "/fournisseurs"],
  ["GET", "/commandes"],
  ["GET", "/dashboard"],
  ["GET", "/ventes/menu-engineering"],
  ["GET", "/ventes/previsions"],
  ["GET", "/ventes/documents"],
  ["GET", "/questions"],
  ["POST", "/achats/proposition", { lignes: [] }],
  ["POST", "/consulting/analyser-recette", {}],
];

test("cuisinier : achats, fournisseurs, ventes, tableau de bord et analyses lui sont fermés (403) ; le chef y accède", async () => {
  for (const [method, chemin, body] of ROUTES_FERMEES) {
    const cuisinier = await appel(jetonCuisinier, method, chemin, body);
    assert.equal(cuisinier.status, 403, `${method} ${chemin} en CUISINIER`);
    const chef = await appel(jetonChef, method, chemin, body);
    assert.notEqual(chef.status, 403, `${method} ${chemin} en CHEF`);
  }
  const suggestions = await appel(jetonCuisinier, "GET", `/recettes/${recetteId}/suggestions-economie`);
  assert.equal(suggestions.status, 403);
  assert.equal((await appel(jetonChef, "GET", `/recettes/${recetteId}/suggestions-economie`)).status, 200);
});

test("cuisinier : aucune réponse des écrans qu'il garde ne contient de prix, de coût ou de marge", async () => {
  const production = await appel(jetonCuisinier, "POST", "/productions", {
    recetteId,
    depotId,
    cible: { mode: "portions", valeur: 1 },
  });
  assert.equal(production.status, 201, await production.clone().text());
  const corpsProduction = await production.json();
  productionId = (corpsProduction as { id: number }).id;

  const lectures: [string, string, unknown?][] = [
    ["GET", "/articles"],
    ["GET", "/recettes"],
    ["GET", `/recettes/${recetteId}`],
    ["GET", "/recettes/toutes-pour-correspondance"],
    ["GET", "/menus"],
    ["GET", `/menus/${menuId}`],
    ["GET", "/mouvements"],
    ["GET", "/depots"],
    ["GET", "/productions"],
    ["GET", `/productions/${productionId}`],
    ["GET", "/societe"],
    ["GET", `/haccp/evaluer/${recetteId}`],
    ["POST", "/production/planifier", { recetteId, cible: { mode: "portions", valeur: 2 } }],
  ];
  const fuites: string[] = [];
  for (const [method, chemin, body] of [...lectures, ["POST /productions", "", corpsProduction] as [string, string, unknown]]) {
    let corps: unknown;
    if (method === "POST /productions") {
      corps = body;
    } else {
      const reponse = await appel(jetonCuisinier, method, chemin, body);
      assert.equal(reponse.status, 200, `${method} ${chemin} : ${reponse.status}`);
      corps = await reponse.json();
    }
    const texte = JSON.stringify(corps);
    for (const temoin of TEMOINS) if (texte.includes(temoin)) fuites.push(`${method} ${chemin} contient ${temoin}`);
    for (const champ of champsDePrix(corps)) fuites.push(`${method} ${chemin} : champ ${champ}`);
  }
  assert.deepEqual(fuites, []);
});

test("témoin : le chef voit bien ces montants (le test ci-dessus prouve quelque chose)", async () => {
  const articles = JSON.stringify(await (await appel(jetonChef, "GET", "/articles")).json());
  assert.ok(articles.includes("43.219"));
  const recette = JSON.stringify(await (await appel(jetonChef, "GET", `/recettes/${recetteId}`)).json());
  assert.ok(recette.includes("87.65") && recette.includes("21.6095"));
  const menu = JSON.stringify(await (await appel(jetonChef, "GET", `/menus/${menuId}`)).json());
  assert.ok(menu.includes("76.54"));
  const societe = JSON.stringify(await (await appel(jetonChef, "GET", "/societe")).json());
  assert.ok(societe.includes("3.217"));
});

test("cuisinier : la fiche PDF reste téléchargeable, sans aucun coût ni prix ; celle du chef les garde", async () => {
  const pdfCuisinier = await appel(jetonCuisinier, "GET", `/recettes/${recetteId}/export-pdf`);
  assert.equal(pdfCuisinier.status, 200);
  const texteCuisinier = texteDuPdf(Buffer.from(await pdfCuisinier.arrayBuffer()));
  assert.match(texteCuisinier, /carottes/);
  assert.doesNotMatch(texteCuisinier, /Coût|Prix|Food cost|43\.2|21\.6|87\.65/);

  const pdfChef = await appel(jetonChef, "GET", `/recettes/${recetteId}/export-pdf`);
  const texteChef = texteDuPdf(Buffer.from(await pdfChef.arrayBuffer()));
  assert.match(texteChef, /Coût/);
  assert.match(texteChef, /87\.65/);
});
