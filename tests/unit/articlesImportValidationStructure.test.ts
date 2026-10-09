import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Chantier F09/F10 — PR I : POST /articles/import plantait en 500 dès qu'un élément du tableau
// `lignes` était null/undefined (accès direct à `ligne.designation` sans vérifier que `ligne` est
// un objet exploitable), alors que les lignes précédentes de ce même import étaient déjà committées
// (pas de transaction globale sur tout l'import — un listing peut compter plusieurs milliers de
// lignes, voir le commentaire au-dessus de POST /import).
//
// RED (sur le code non modifié, voir l'historique de ce fichier dans le rapport d'audit) a établi
// empiriquement que SEUL un élément null/undefined reproduit un vrai 500 : un nombre ou une chaîne
// à la place d'un objet ne fait PAS crasher (accès de propriété JS sûr sur un primitif — jamais une
// exception), et des propriétés imbriquées mal typées à l'intérieur d'un objet par ailleurs valide
// ne crashent pas non plus. Correctif : un garde-fou structurel minimal (`schemaLigneImportArticles`,
// voir server/routes/articles.ts) rejette tout élément qui n'est PAS un objet exploitable
// (null/undefined/primitif/tableau) EN LE SIGNALANT dans `erreurs`, exactement comme toute autre
// ligne rejetée pour une raison métier — jamais un 500 global, jamais une interruption des autres
// lignes de l'import (stratégie B, cohérente avec le fonctionnement ligne-par-ligne déjà en place
// pour toutes les autres erreurs de cet endpoint : fournisseur ambigu/inactif, prix illisible, unité
// introuvable, etc.)
//
// Chaque test utilise une désignation lexicalement très différente des autres (mots réels sans
// vocabulaire partagé) : des désignations trop proches (même préfixe + suffixe numérique) peuvent
// dépasser accidentellement le seuil de similarité (0.6) avec un article créé par un autre test de
// ce fichier et basculer en correspondance approximative en attente — observé empiriquement pendant
// la phase RED, sans aucun rapport avec le défaut structurel étudié ici.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let fournisseurId: number;
let fournisseurNom: string;

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function supprimerArticlePourDesignation(designation: string) {
  const article = await prisma.article.findFirst({ where: { nom: designation, societeId } });
  if (!article) return;
  await prisma.tarifArticle.deleteMany({ where: { articleId: article.id } });
  await prisma.article.delete({ where: { id: article.id } });
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

  token = await connecterAdminDeTest(baseUrl);

  const societe = (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const categorie = (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ?? (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
  categorieId = categorie.id;
  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;
  if (!(await prisma.conditionnement.findFirst())) {
    await prisma.conditionnement.create({ data: { nom: "Unité" } });
  }
  if (!(await prisma.unite.findFirst({ where: { symbole: { equals: "pièce", mode: "insensitive" } } }))) {
    await prisma.unite.create({ data: { nom: "Pièce", symbole: "pièce", type: "piece", facteurBase: 1 } });
  }

  fournisseurNom = `VALSTRUCT ${randomUUID()}`;
  const fournisseur = await prisma.fournisseur.create({ data: { nom: fournisseurNom, societeId } });
  fournisseurId = fournisseur.id;
});

after(async () => {
  try {
    await prisma.fournisseur.delete({ where: { id: fournisseurId } }).catch(() => {});
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

function ligneValide(designation: string) {
  return { designation, prix: "10,00" };
}

test("GREEN cas 1 : [ligneValide, null] -> 200, plus de 500, aucune écriture tentée pour l'élément invalide, signalé dans erreurs", async () => {
  const designation = "Jambon Fumé Tranché Artisanal";

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ categorieId, tvaId, fournisseurNom, lignes: [ligneValide(designation), null] }),
  });

  assert.equal(reponse.status, 200, "GREEN : plus de 500 pour un élément null");
  const corps = await reponse.json();
  assert.equal(corps.crees, 1, "la ligne valide est créée normalement");
  assert.equal(corps.erreurs.length, 1);
  assert.match(corps.erreurs[0], /Ligne 2.*donnée invalide/);

  const articleCree = await prisma.article.findFirst({ where: { nom: designation, societeId } });
  assert.ok(articleCree);

  await supprimerArticlePourDesignation(designation);
});

test("GREEN cas 2 : [ligneValide, 42] -> 200, la ligne numérique est désormais signalée dans erreurs (comportement renforcé explicitement demandé par l'audit)", async () => {
  const designation = "Camembert Affiné Normand Fermier";

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ categorieId, tvaId, fournisseurNom, lignes: [ligneValide(designation), 42] }),
  });

  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.crees, 1);
  assert.equal(corps.erreurs.length, 1);
  assert.match(corps.erreurs[0], /Ligne 2.*donnée invalide/);

  await supprimerArticlePourDesignation(designation);
});

test('GREEN cas 3 : [ligneValide, "texte"] -> 200, la ligne chaîne est désormais signalée dans erreurs', async () => {
  const designation = "Riz Basmati Premium Parfumé";

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ categorieId, tvaId, fournisseurNom, lignes: [ligneValide(designation), "texte"] }),
  });

  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.crees, 1);
  assert.equal(corps.erreurs.length, 1);
  assert.match(corps.erreurs[0], /Ligne 2.*donnée invalide/);

  await supprimerArticlePourDesignation(designation);
});

test("GREEN cas 3bis : [ligneValide, [1,2,3]] -> un tableau à la place d'un objet est également signalé, jamais traité comme une ligne", async () => {
  const designation = "Tomate Cœur de Bœuf Plateau";

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ categorieId, tvaId, fournisseurNom, lignes: [ligneValide(designation), [1, 2, 3]] }),
  });

  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.crees, 1);
  assert.equal(corps.erreurs.length, 1);
  assert.match(corps.erreurs[0], /Ligne 2.*donnée invalide/);

  await supprimerArticlePourDesignation(designation);
});

test("GREEN cas 4 : propriétés imbriquées de types invalides dans un objet par ailleurs valide -> comportement métier inchangé (pas de crash, pas de nouveau message structurel)", async () => {
  const designationValide = "Huile Olive Extra Vierge Bio";
  const designationAutre = "Farine Blé Complet Moulin";

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      categorieId,
      tvaId,
      fournisseurNom,
      lignes: [
        ligneValide(designationValide),
        {
          designation: designationAutre,
          prix: { valeur: 10 },
          conditionnement: ["12", "KG"],
          confirmationArticleId: { nested: true },
          fournisseur: 12345,
          categorie: { nom: "x" },
        },
      ],
    }),
  });

  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  // La 2e ligne est un objet valide structurellement : notre garde-fou ne la rejette jamais. Elle
  // peut être refusée pour une raison MÉTIER (prix illisible), mais jamais avec le message
  // structurel "donnée invalide" de ce correctif.
  assert.ok(!corps.erreurs.some((e: string) => e.includes("donnée invalide")));

  await supprimerArticlePourDesignation(designationValide);
  await supprimerArticlePourDesignation(designationAutre);
});

test("GREEN cas 5 : lignes absent, vide ou de type incorrect -> toujours 400 avant toute écriture (inchangé)", async () => {
  for (const payload of [{}, { lignes: [] }, { lignes: "pas un tableau" }, { lignes: null }, { lignes: 42 }]) {
    const reponse = await fetch(`${baseUrl}/api/articles/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ categorieId, tvaId, fournisseurNom, ...payload }),
    });
    assert.equal(reponse.status, 400, `payload ${JSON.stringify(payload)} doit rester rejeté en 400`);
  }
});

test("GREEN — régression : import valide multi-lignes inchangé (même compte de créations qu'avant ce correctif)", async () => {
  const d1 = "Poireau Botte Terre Frais";
  const d2 = "Carotte Botte Sable Fine";

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ categorieId, tvaId, fournisseurNom, lignes: [ligneValide(d1), ligneValide(d2)] }),
  });

  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.crees, 2);
  assert.equal(corps.erreurs.length, 0);

  await supprimerArticlePourDesignation(d1);
  await supprimerArticlePourDesignation(d2);
});

test("GREEN — une panne DB réelle reste une erreur serveur (500), jamais maquillée en 400 par ce correctif", async () => {
  const designation = "Saumon Fumé Norvège Tranche";

  const originalTransaction = prisma.$transaction.bind(prisma);
  (prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = (async (
    arg: unknown,
    ...reste: unknown[]
  ) => {
    if (typeof arg !== "function") {
      return (originalTransaction as (...a: unknown[]) => unknown)(arg, ...reste);
    }
    return (originalTransaction as (...a: unknown[]) => unknown)(async (tx: unknown) => {
      const txArticle = (tx as { article: { create: (...args: unknown[]) => Promise<unknown> } }).article;
      txArticle.create = async () => {
        throw new Error("PANNE SIMULÉE (test PR I) : échec déterministe confiné aux tests, jamais une panne réelle");
      };
      return (arg as (tx: unknown) => unknown)(tx);
    }, ...reste);
  }) as typeof prisma.$transaction;

  let statut: number;
  try {
    const reponse = await fetch(`${baseUrl}/api/articles/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ categorieId, tvaId, fournisseurNom, lignes: [ligneValide(designation)] }),
    });
    statut = reponse.status;
  } finally {
    (prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = originalTransaction;
  }

  assert.equal(statut, 500, "une panne DB/interne réelle ne doit jamais être maquillée en 400");

  const articleCree = await prisma.article.findFirst({ where: { nom: designation, societeId } });
  assert.equal(articleCree, null, "la transaction de création (article+tarif) doit avoir été annulée");
});

test("GREEN — contrôle négatif : un article témoin d'une autre société n'est jamais modifié", async () => {
  const autreSociete = await prisma.societe.create({ data: { nom: `VALSTRUCT Autre Societe ${randomUUID()}` } });
  const autreCategorie = await prisma.categorie.create({ data: { nom: "Cat autre société", societeId: autreSociete.id } });
  const temoin = await prisma.article.create({
    data: {
      nom: "Beurre Doux Motte Normande",
      categorieId: autreCategorie.id,
      tvaId,
      societeId: autreSociete.id,
      type: "MATIERE_PREMIERE",
    },
  });

  const reponse = await fetch(`${baseUrl}/api/articles/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ categorieId, tvaId, fournisseurNom, lignes: [null] }),
  });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.erreurs.length, 1);

  const temoinRelu = await prisma.article.findUniqueOrThrow({ where: { id: temoin.id } });
  assert.deepEqual(temoinRelu, temoin);

  await prisma.article.delete({ where: { id: temoin.id } });
  await prisma.categorie.delete({ where: { id: autreCategorie.id } });
  await prisma.societe.delete({ where: { id: autreSociete.id } });
});
