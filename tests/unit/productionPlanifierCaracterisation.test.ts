import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { JournalErreur } from "@prisma/client";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Tests de régression (plus simple caractérisation) de POST /api/production/planifier, sur le
// correctif appliqué à server/routes/production.ts : toute exception qui n'est ni
// "Recette introuvable" ni "Cible de production invalide" doit désormais produire un statut 500,
// un corps générique (jamais le message brut de l'exception) et une entrée JournalErreur réelle
// (même mécanisme que server/routes/achats.ts, server/utils/journalErreurs.ts).
//
// Deux pannes distinctes, volontairement non confondues :
//   - [3] une panne simulée à la frontière d'accès aux données : prisma.recette.findFirst (l'appel
//     réellement effectué par planifierProduction) est remplacé pour l'espace d'un seul test par une
//     fonction qui lève une exception portant un message unique (PANNE_PLANIFIER_<uuid>). Ce n'est
//     PAS une interruption réseau/Postgres réelle, seulement une simulation à l'endpoint d'accès aux
//     données le plus proche du point d'entrée.
//   - [4] une violation d'invariant applicatif (recette.portions = 0), obtenue par un appel Prisma
//     direct qui contourne POST/PUT /api/recettes (ces deux routes appellent calculerCoutRecette
//     dans leur transaction d'écriture, voir recettes.ts L526-532, qui annule toute création/
//     modification où portions<=0 ; aucune revue exhaustive de tous les chemins d'écriture de
//     l'application n'a été faite, cette description reste scopée aux chemins effectivement lus).
//
// Identification des entrées JournalErreur RÉELLEMENT créées par chaque appel : jamais par un
// comptage global route/fenêtre temporelle (qui pourrait capturer une entrée créée par un autre
// fichier de test exécuté en concurrence) — toujours par interception confinée et restaurée de
// prisma.journalErreur.create (la seule écriture que journaliserErreur effectue), qui donne accès
// à la ligne exacte créée par CET appel précis, avec son contexte complet (route, statutHttp,
// societeId, origine). Les ids ainsi identifiés sont enregistrés pour nettoyage avant toute
// assertion qui pourrait échouer.

let server: Server;
let baseUrl: string;
let token: string;
let societeId: number;
let categorieId: number;
let tvaId: number;
let uniteId: number;
let articleId: number;
const recetteIds: number[] = [];
const journalErreurIds: number[] = [];

async function creerRecette(body: unknown): Promise<{ id: number }> {
  const reponse = await fetch(`${baseUrl}/api/recettes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const texte = await reponse.text();
  assert.equal(reponse.status, 201, `Création de recette (fixture) échouée : ${texte}`);
  const recette = JSON.parse(texte);
  recetteIds.push(recette.id);
  return recette;
}

async function lireRecetteAvecLignesOrdonnees(id: number) {
  return prisma.recette.findUniqueOrThrow({
    where: { id },
    include: { lignes: { orderBy: [{ ordre: "asc" }, { id: "asc" }] } },
  });
}

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
      // Enregistré immédiatement après la création réelle, avant même de rendre la main à
      // `executer` : garantit le nettoyage dans after() même si `executer` échoue APRÈS avoir
      // déclenché cette création (ex. une assertion qui échouerait entre deux appels HTTP).
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

  const categorie =
    (await prisma.categorie.findFirst({ where: { societeId }, orderBy: { id: "asc" } })) ??
    (await prisma.categorie.create({ data: { nom: "Catégorie de test", societeId } }));
  categorieId = categorie.id;

  const tva = (await prisma.tVA.findFirst()) ?? (await prisma.tVA.create({ data: { nom: "TVA test", taux: 5.5 } }));
  tvaId = tva.id;

  const unite =
    (await prisma.unite.findFirst({ where: { symbole: "g" } })) ??
    (await prisma.unite.create({ data: { nom: "Gramme", symbole: "g", type: "poids", facteurBase: 1 } }));
  uniteId = unite.id;

  const article = await prisma.article.create({
    data: {
      nom: `PRODUCTION PLANIFIER CARACTERISATION Article ${Date.now()}`,
      reference: `CARAC-PLANIFIER-${Date.now()}`,
      type: "MATIERE_PREMIERE",
      categorieId,
      tvaId,
      societeId,
      rendement: 100,
      actif: true,
    },
  });
  articleId = article.id;
});

after(async () => {
  try {
    // Nettoyage précis par id (jamais par route/fenêtre temporelle globale) des seules entrées
    // JournalErreur réellement créées par ce fichier — aucun .catch() avalant une erreur de
    // nettoyage : une défaillance ici doit se propager, pas être masquée.
    await prisma.journalErreur.deleteMany({ where: { id: { in: journalErreurIds } } });
    await prisma.recetteLigne.deleteMany({ where: { recetteId: { in: recetteIds } } });
    await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
    await prisma.article.deleteMany({ where: { id: articleId } });
  } finally {
    // server.close doit être tenté même si le nettoyage ci-dessus a échoué ; l'erreur de nettoyage
    // (si elle existe) continue de se propager après ce finally, elle n'est jamais avalée ici.
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("[RÉGRESSION 1] planification valide (référence, comportement conservé) : 200, corps cohérent", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "CARACTERISATION PLANIFIER VALIDE",
    categorieId: null,
    sousCategorieId: null,
    portions: 2,
    lignes: [{ articleId, quantite: 100, uniteId, gainCuissonPct: 0 }],
    etapes: [],
  });

  const reponse = await fetch(`${baseUrl}/api/production/planifier`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recetteId: recette.id, cible: { mode: "portions", valeur: 4 } }),
  });
  assert.equal(reponse.status, 200);
  const corps = await reponse.json();
  assert.equal(corps.echelle, 2);
  assert.equal(corps.lignes[0].quantiteProduction, 200);
});

test("[RÉGRESSION 2] erreur métier conservée (atteignable via l'API validée, sans aucune corruption) — recette sans ligne, cible en poidsFiniG : poidsFiniTotalG=0 fait fixer échelle à 0 (pas à l'infini, voir planifierProduction.ts L25-27 : ternaire défensive, jamais de division par zéro) -> toujours 400 'Cible de production invalide', toujours non journalisée", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "CARACTERISATION PLANIFIER SANS LIGNE",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [],
    etapes: [],
  });

  const { resultat: reponse, entrees } = await avecInterceptionJournalisation(() =>
    fetch(`${baseUrl}/api/production/planifier`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ recetteId: recette.id, cible: { mode: "poidsFiniG", valeur: 9000 } }),
    })
  );

  assert.equal(reponse.status, 400, "comportement conservé : cette erreur métier reste un 400");
  const corps = await reponse.json();
  assert.equal(corps.error, "Cible de production invalide");
  assert.equal(entrees.length, 0, "comportement conservé : cette erreur métier atteignable reste non journalisée (entrées réellement créées pendant cet appel précis, via interception, jamais par route/fenêtre temporelle)");
});

test("[RÉGRESSION 3] panne simulée à la frontière d'accès aux données — prisma.recette.findFirst (l'appel réellement exécuté par planifierProduction) remplacé pour lever une exception à message unique, PAS une interruption réseau/Postgres réelle -> désormais 500, corps générique, UNE entrée JournalErreur réelle portant ce message et le contexte attendu, fixtures intégralement inchangées", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "CARACTERISATION PLANIFIER PANNE ACCES DONNEES",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId, quantite: 100, uniteId, gainCuissonPct: 0 }],
    etapes: [],
  });
  const avant = await lireRecetteAvecLignesOrdonnees(recette.id);

  const messageUnique = `PANNE_PLANIFIER_${randomUUID()}`;
  const findFirstOriginal = prisma.recette.findFirst;
  let reponse: Response;
  let entrees: JournalErreur[];
  try {
    const interception = await avecInterceptionJournalisation(async () => {
      // @ts-expect-error — remplacement volontaire et confiné à ce test, restauré ci-dessous dans
      // le finally AVANT toute assertion : une assertion qui échouerait plus bas ne peut donc
      // jamais empêcher cette restauration.
      prisma.recette.findFirst = async () => {
        throw new Error(messageUnique);
      };
      return fetch(`${baseUrl}/api/production/planifier`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ recetteId: recette.id, cible: { mode: "portions", valeur: 4 } }),
      });
    });
    reponse = interception.resultat;
    entrees = interception.entrees;
  } finally {
    prisma.recette.findFirst = findFirstOriginal;
  }

  assert.equal(reponse.status, 500, "correctif attendu : une panne à la frontière d'accès aux données est désormais renvoyée en 500, jamais en 400");
  const corps = await reponse.json();
  assert.deepEqual(corps, { error: "Impossible de planifier la production" }, "message générique attendu, jamais le message brut de l'exception");

  assert.equal(entrees.length, 1, "exactement une entrée JournalErreur doit avoir été créée par cet appel précis (interception confinée, pas un comptage global)");
  const [entree] = entrees;
  assert.equal(entree.message, messageUnique, "l'entrée journalisée doit porter le message unique de l'injection");
  assert.equal(entree.origine, "SERVEUR");
  assert.equal(entree.methode, "POST");
  assert.equal(entree.route, "/api/production/planifier");
  assert.equal(entree.statutHttp, 500);
  assert.equal(entree.societeId, societeId);

  const apres = await lireRecetteAvecLignesOrdonnees(recette.id);
  assert.deepEqual(apres, avant, "comparaison complète avant/après (lignes ordonnées de façon déterministe) : aucune écriture résiduelle, route en lecture seule");
});

test("[RÉGRESSION 4] violation d'invariant applicatif, cas distinct de [3] — recette dont les portions sont mises à 0 par un appel Prisma direct (fixture ainsi obtenue parce que POST/PUT /api/recettes appellent calculerCoutRecette DANS leur transaction d'écriture, voir L526-532 ; aucune revue exhaustive de tous les chemins d'écriture de l'application n'a été faite) -> désormais 500, corps générique, UNE entrée JournalErreur réelle vérifiée, fixtures intégralement inchangées", async () => {
  const recette = await creerRecette({
    societeId,
    nom: "CARACTERISATION PLANIFIER PANNE INTERNE",
    categorieId: null,
    sousCategorieId: null,
    portions: 1,
    lignes: [{ articleId, quantite: 100, uniteId, gainCuissonPct: 0 }],
    etapes: [],
  });

  // Fixture obtenue par un appel Prisma direct, contournant POST/PUT /api/recettes (voir L526-532
  // ci-dessus) — même technique que H1/H2 du chantier MENUS.
  await prisma.recette.update({ where: { id: recette.id }, data: { portions: 0 } });
  const avant = await lireRecetteAvecLignesOrdonnees(recette.id);

  const { resultat: reponse, entrees } = await avecInterceptionJournalisation(() =>
    fetch(`${baseUrl}/api/production/planifier`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ recetteId: recette.id, cible: { mode: "portions", valeur: 4 } }),
    })
  );

  assert.equal(reponse.status, 500, "correctif attendu : cette violation d'invariant est désormais renvoyée en 500, jamais en 400");
  const corps = await reponse.json();
  assert.deepEqual(corps, { error: "Impossible de planifier la production" }, "message générique attendu, jamais le message brut de l'exception (\"Nombre de portions invalide\")");

  assert.equal(entrees.length, 1, "exactement une entrée JournalErreur doit avoir été créée par cet appel précis");
  const [entree] = entrees;
  assert.equal(entree.message, "Nombre de portions invalide");
  assert.equal(entree.origine, "SERVEUR");
  assert.equal(entree.route, "/api/production/planifier");
  assert.equal(entree.statutHttp, 500);
  assert.equal(entree.societeId, societeId);

  const apres = await lireRecetteAvecLignesOrdonnees(recette.id);
  assert.deepEqual(apres, avant, "comparaison complète avant/après (lignes ordonnées de façon déterministe) : aucune écriture résiduelle, route en lecture seule");
});

test("[RÉGRESSION 5] contrôle positif, mécanisme central existant — le même type d'exception (portions invalides), rencontré via POST /api/recettes (route d'écriture, qui appelle repondreErreurEcriture), produit toujours 500 + message générique + rollback + une entrée JournalErreur réelle identifiée par interception : prouve que la détection utilisée ci-dessus détecte bien une écriture quand il y en a une", async () => {
  const nom = `CARACTERISATION CONTROLE POSITIF ${randomUUID()}`;

  const { resultat: reponse, entrees } = await avecInterceptionJournalisation(() =>
    fetch(`${baseUrl}/api/recettes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        societeId,
        nom,
        categorieId: null,
        sousCategorieId: null,
        portions: 0,
        lignes: [],
        etapes: [],
      }),
    })
  );

  assert.equal(reponse.status, 500, "repondreErreurEcriture renvoie bien 500 pour cette même exception interne");
  const corps = await reponse.json();
  assert.equal(corps.error, "Impossible de créer la recette", "message générique attendu (jamais le message brut de l'exception)");

  const creee = await prisma.recette.findFirst({ where: { nom } });
  assert.equal(creee, null, "rollback confirmé : aucune recette invalide ne doit rester committée");

  assert.equal(entrees.length, 1, "le mécanisme de détection (interception de prisma.journalErreur.create) détecte bel et bien une écriture quand repondreErreurEcriture en produit une");
  const [entree] = entrees;
  assert.equal(entree.message, "Nombre de portions invalide");
  assert.equal(entree.route, "/api/recettes");
  assert.equal(entree.statutHttp, 500);
});
