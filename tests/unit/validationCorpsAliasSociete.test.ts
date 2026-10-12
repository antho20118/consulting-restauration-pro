import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { JournalErreur } from "@prisma/client";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { normaliserTexte } from "../../server/utils/normaliserTexte.js";
import { creerUtilisateurAutreSocieteDeTest } from "../helpers/auth.js";

// Tests de régression de la validation du corps de PUT /api/societe/:id et POST
// /api/alias-ingredients — voir server/routes/societe.ts et server/routes/aliasIngredients.ts.
//
// Avant correctif, aucune de ces deux routes ne validait la structure du corps :
//   - PUT /societe/:id : un nom d'un mauvais type (nombre, null) ou un corps absent ressortait en
//     500, journalisé comme une panne ; un nom vide ou blanc était enregistré tel quel ;
//   - POST /alias-ingredients : `correspondances` non tableau, un élément null, un texte non chaîne
//     ou un articleId non entier/hors bornes INT4 ressortait en 500 (ou atteignait Prisma).
// Ces cas sont désormais refusés en 400, sans écriture et sans entrée JournalErreur. Le contrat
// permissif existant est préservé : PUT sans `nom` ne le modifie pas, les trois états de
// coefficientMultiplicateur (absent/null/valeur) sont inchangés, et POST continue d'ignorer
// silencieusement (204) une correspondance vide, sans article ou visant un article d'une autre
// société.
//
// Toutes les écritures portent sur une société créée pour ce fichier (creerUtilisateurAutreSociete-
// DeTest), jamais sur la « Société de test » partagée par les autres fichiers exécutés en parallèle.

const PREFIXE = "VALIDATION-CORPS-ALIAS-SOCIETE";

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let articleId: number;
let categorieId: number;
const journalErreurIds: number[] = [];
const textesAlias: string[] = [];

async function requete(methode: "PUT" | "POST", chemin: string, corps?: unknown, typeContenu = "application/json") {
  const reponse = await fetch(`${baseUrl}${chemin}`, {
    method: methode,
    headers: { ...(corps === undefined ? {} : { "Content-Type": typeContenu }), Authorization: `Bearer ${token}` },
    body: corps === undefined ? undefined : typeof corps === "string" ? corps : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  return { status: reponse.status, corps: texte ? JSON.parse(texte) : null };
}

const lireSociete = () => prisma.societe.findUniqueOrThrow({ where: { id: societeId } });

function texteUnique() {
  const texte = `${PREFIXE} ingrédient ${randomUUID()}`;
  textesAlias.push(normaliserTexte(texte));
  return texte;
}

const lireAlias = (texte: string) =>
  prisma.aliasIngredientImport.findUnique({ where: { texteNormalise: normaliserTexte(texte) } });

// Interception confinée de la seule écriture que journaliserErreur effectue réellement
// (prisma.journalErreur.create) : capture les lignes exactement créées par `executer`, puis
// restaure la méthode originale dans un finally, que `executer` réussisse ou échoue.
async function avecInterceptionJournalisation<T>(executer: () => Promise<T>): Promise<{ resultat: T; entrees: JournalErreur[] }> {
  const original = prisma.journalErreur.create;
  const entrees: JournalErreur[] = [];
  let resultat: T;
  try {
    // @ts-expect-error — remplacement volontaire et confiné à cette fonction, restauré ci-dessous.
    prisma.journalErreur.create = async (args: Parameters<typeof original>[0]) => {
      const entree = await original(args);
      journalErreurIds.push(entree.id);
      entrees.push(entree);
      return entree;
    };
    resultat = await executer();
  } finally {
    prisma.journalErreur.create = original;
  }
  return { resultat, entrees };
}

// Remplace `cible[methode]` par une fonction qui lève une erreur au message unique, le temps de
// `executer`, puis restaure l'original dans un finally.
async function avecPanne<T>(cible: object, methode: string, message: string, executer: () => Promise<T>): Promise<T> {
  const objet = cible as Record<string, unknown>;
  const original = objet[methode];
  try {
    objet[methode] = async () => {
      throw new Error(message);
    };
    return await executer();
  } finally {
    objet[methode] = original;
  }
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

  const compte = await creerUtilisateurAutreSocieteDeTest(baseUrl);
  token = compte.token;
  societeId = compte.societeId;
  await prisma.societe.update({ where: { id: societeId }, data: { nom: `${PREFIXE} société`, coefficientMultiplicateur: 3 } });

  const categorie = await prisma.categorie.create({ data: { nom: `${PREFIXE} catégorie`, societeId } });
  categorieId = categorie.id;
  const tva = await prisma.tVA.findFirstOrThrow({ orderBy: { id: "asc" } });
  const article = await prisma.article.create({
    data: { type: "MATIERE_PREMIERE", nom: `${PREFIXE} article`, societeId, categorieId, tvaId: tva.id },
  });
  articleId = article.id;
});

after(async () => {
  try {
    await prisma.journalErreur.deleteMany({ where: { id: { in: journalErreurIds } } });
    await prisma.aliasIngredientImport.deleteMany({ where: { texteNormalise: { in: textesAlias } } });
    await prisma.aliasIngredientImport.deleteMany({ where: { article: { societeId } } });
    await prisma.article.deleteMany({ where: { societeId } });
    await prisma.categorie.deleteMany({ where: { societeId } });
    await prisma.utilisateur.deleteMany({ where: { societeId } });
    await prisma.societe.deleteMany({ where: { id: societeId } });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

// --- PUT /api/societe/:id : contrats préservés ---

test("[S1] PUT nom + coefficient valides : 200, enregistrés", async () => {
  const nom = `${PREFIXE} renommée ${randomUUID()}`;
  const r = await requete("PUT", `/api/societe/${societeId}`, { nom, coefficientMultiplicateur: 2.5 });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  const apres = await lireSociete();
  assert.equal(apres.nom, nom);
  assert.equal(apres.coefficientMultiplicateur, 2.5);
});

test("[S2] PUT sans nom : 200, nom conservé, coefficient modifié", async () => {
  const avant = await lireSociete();
  const r = await requete("PUT", `/api/societe/${societeId}`, { coefficientMultiplicateur: 4 });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  const apres = await lireSociete();
  assert.equal(apres.nom, avant.nom);
  assert.equal(apres.coefficientMultiplicateur, 4);
});

test("[S3] PUT coefficient non numérique : 400 « Coefficient multiplicateur invalide » inchangé", async () => {
  const avant = await lireSociete();
  const r = await requete("PUT", `/api/societe/${societeId}`, { nom: avant.nom, coefficientMultiplicateur: "2" });
  assert.equal(r.status, 400);
  assert.deepEqual(r.corps, { error: "Coefficient multiplicateur invalide" });
  assert.deepEqual(await lireSociete(), avant);
});

test("[S4] PUT sur l'id d'une autre société, même avec un corps invalide : 404 inchangé", async () => {
  const r = await requete("PUT", `/api/societe/${societeId + 1000000}`, { nom: 123 });
  assert.equal(r.status, 404);
  assert.deepEqual(r.corps, { error: "Société introuvable" });
});

// --- PUT /api/societe/:id : corps invalides refusés ---

// Un corps JSON qui n'est ni un objet ni un tableau (ex. "texte") est déjà refusé en 400 par
// express.json() (mode strict) avant d'atteindre la route : hors du périmètre de ces tests.
const corpsSocieteInvalides: [string, unknown][] = [
  ["nom vide", { nom: "" }],
  ["nom blanc", { nom: "   " }],
  ["nom nombre", { nom: 123 }],
  ["nom null", { nom: null }],
  ["corps tableau", []],
];

for (const [libelle, corps] of corpsSocieteInvalides) {
  test(`[S5] PUT ${libelle} : 400 « Société invalide », société inchangée, rien journalisé`, async () => {
    const avant = await lireSociete();
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      requete("PUT", `/api/societe/${societeId}`, corps)
    );
    assert.equal(resultat.status, 400, JSON.stringify(resultat.corps));
    assert.equal(resultat.corps?.error, "Société invalide");
    assert.equal(entrees.length, 0);
    assert.deepEqual(await lireSociete(), avant);
  });
}

test("[S6] PUT sans corps : 400 « Société invalide », société inchangée, rien journalisé", async () => {
  const avant = await lireSociete();
  const { resultat, entrees } = await avecInterceptionJournalisation(() =>
    requete("PUT", `/api/societe/${societeId}`)
  );
  assert.equal(resultat.status, 400, JSON.stringify(resultat.corps));
  assert.equal(resultat.corps?.error, "Société invalide");
  assert.equal(entrees.length, 0);
  assert.deepEqual(await lireSociete(), avant);
});

test("[S7] PUT panne interne simulée : 500 générique et journalisé, société inchangée", async () => {
  const avant = await lireSociete();
  const marqueur = `${PREFIXE} panne société ${randomUUID()}`;
  const { resultat, entrees } = await avecInterceptionJournalisation(() =>
    avecPanne(prisma.societe, "update", marqueur, () =>
      requete("PUT", `/api/societe/${societeId}`, { nom: `${PREFIXE} jamais écrit` })
    )
  );
  assert.equal(resultat.status, 500);
  assert.deepEqual(resultat.corps, { error: "Impossible de modifier la société" });
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].message, marqueur);
  assert.deepEqual(await lireSociete(), avant);
});

// --- POST /api/alias-ingredients : contrats préservés ---

test("[A1] POST correspondance valide : 204, alias enregistré vers l'article", async () => {
  const texte = texteUnique();
  const r = await requete("POST", "/api/alias-ingredients", { correspondances: [{ texte, articleId }] });
  assert.equal(r.status, 204, JSON.stringify(r.corps));
  assert.equal((await lireAlias(texte))?.articleId, articleId);
});

test("[A2] POST correspondances vides, sans article ou à 0 : 204, ignorées sans erreur", async () => {
  const textes = [texteUnique(), texteUnique(), texteUnique()];
  const r = await requete("POST", "/api/alias-ingredients", {
    correspondances: [
      { texte: "", articleId },
      { texte: textes[0], articleId: null },
      { texte: textes[1], articleId: 0 },
      { texte: textes[2] },
      { articleId },
    ],
  });
  assert.equal(r.status, 204, JSON.stringify(r.corps));
  for (const texte of textes) assert.equal(await lireAlias(texte), null);
});

test("[A3] POST sans correspondances, ou correspondances null : 204, aucune écriture", async () => {
  for (const corps of [{}, { correspondances: null }, { correspondances: [] }]) {
    const r = await requete("POST", "/api/alias-ingredients", corps);
    assert.equal(r.status, 204, `${JSON.stringify(corps)} : ${JSON.stringify(r.corps)}`);
  }
});

// --- POST /api/alias-ingredients : corps invalides refusés ---

function corpsAliasInvalides(texte: string): [string, unknown][] {
  return [
    ["correspondances chaîne", { correspondances: "texte" }],
    ["correspondances objet", { correspondances: { texte, articleId } }],
    ["élément null", { correspondances: [null] }],
    ["texte nombre", { correspondances: [{ texte: 42, articleId }] }],
    ["articleId chaîne", { correspondances: [{ texte, articleId: String(articleId) }] }],
    ["articleId décimal", { correspondances: [{ texte, articleId: articleId + 0.5 }] }],
    ["articleId hors bornes INT4", { correspondances: [{ texte, articleId: 2147483648 }] }],
    ["corps tableau", [{ texte, articleId }]],
  ];
}

for (const [libelle] of corpsAliasInvalides("")) {
  test(`[A4] POST ${libelle} : 400 « Correspondances invalides », aucun alias écrit, rien journalisé`, async () => {
    const texte = texteUnique();
    const corps = corpsAliasInvalides(texte).find(([l]) => l === libelle)![1];
    const { resultat, entrees } = await avecInterceptionJournalisation(() =>
      requete("POST", "/api/alias-ingredients", corps)
    );
    assert.equal(resultat.status, 400, JSON.stringify(resultat.corps));
    assert.equal(resultat.corps?.error, "Correspondances invalides");
    assert.equal(entrees.length, 0);
    assert.equal(await lireAlias(texte), null);
  });
}

test("[A5] POST sans corps : 400 « Correspondances invalides », rien journalisé", async () => {
  const { resultat, entrees } = await avecInterceptionJournalisation(() => requete("POST", "/api/alias-ingredients"));
  assert.equal(resultat.status, 400, JSON.stringify(resultat.corps));
  assert.equal(resultat.corps?.error, "Correspondances invalides");
  assert.equal(entrees.length, 0);
});

test("[A6] POST un seul élément invalide parmi des valides : 400, aucun alias écrit (pas d'écriture partielle)", async () => {
  const texteValide = texteUnique();
  const r = await requete("POST", "/api/alias-ingredients", {
    correspondances: [{ texte: texteValide, articleId }, { texte: 42, articleId }],
  });
  assert.equal(r.status, 400);
  assert.equal(await lireAlias(texteValide), null);
});

test("[A7] POST panne interne simulée : 500 générique et journalisé", async () => {
  const texte = texteUnique();
  const marqueur = `${PREFIXE} panne alias ${randomUUID()}`;
  const { resultat, entrees } = await avecInterceptionJournalisation(() =>
    avecPanne(prisma.aliasIngredientImport, "upsert", marqueur, () =>
      requete("POST", "/api/alias-ingredients", { correspondances: [{ texte, articleId }] })
    )
  );
  assert.equal(resultat.status, 500);
  assert.deepEqual(resultat.corps, { error: "Impossible d'enregistrer les correspondances d'ingrédients" });
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].message, marqueur);
  assert.equal(await lireAlias(texte), null);
});

test("[A8] POST articleId décimal : aucun alias n'est jamais écrit vers l'article de l'id tronqué", async () => {
  const texte = texteUnique();
  await requete("POST", "/api/alias-ingredients", { correspondances: [{ texte, articleId: articleId + 0.5 }] });
  assert.equal(await lireAlias(texte), null, "l'id décimal ne doit jamais être tronqué vers un article existant");
});
