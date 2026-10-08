import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterAdminDeTest } from "../helpers/auth.js";

// Chantier atomicité F09/F10 : POST /listings-fournisseur/:fournisseurId,
// POST /listings-fournisseur/factures/:fournisseurId et POST /ventes/import créaient leur
// document et ses lignes via des écritures Prisma individuelles, jamais englobées dans une
// transaction. Une exception survenant APRÈS qu'au moins une ligne ait été écrite laissait un
// document orphelin partiellement rempli (déjà démontré empiriquement dans le rapport d'audit
// F09/F10, via des payloads malformés aujourd'hui tous rejetés en amont par PR #105/#106).
//
// Ces payloads malformés ne permettent donc plus de déclencher une panne EN COURS de boucle : ce
// fichier injecte une panne déterministe, confinée à ces tests, pour continuer à prouver que
// l'ABSENCE de transaction (avant ce correctif) laisse une écriture partielle, et que sa PRÉSENCE
// (après ce correctif) garantit un rollback complet. Le mécanisme patche à la fois l'appel direct
// (`prisma.<modèle>.create`, utilisé par le code non corrigé) et `prisma.$transaction` lui-même
// (pour intercepter le `tx` réel que Prisma fournit au code corrigé) — voir la validation
// empirique de ce mécanisme dans le rapport. Jamais un monkeypatch de l'API interne de Prisma :
// seules les API publiques `$transaction` et les délégués de modèle sont touchées, toujours
// restaurées à la fin de chaque test.

const PREFIXE = "ATOMICITE TEST";

let server: Server;
let baseUrl: string;
let token: string;
let dossierTemporaire: string;
let societeId: number;
let fournisseurId: number;
let recetteAtomiciteId: number;
let recetteAtomiciteNom: string;
const documentVentesIds: number[] = [];
const recetteIds: number[] = [];

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// Injecteur de panne de test : fait échouer la Nième création du modèle désigné, que le code
// appelant passe par le client racine (`prisma.<modele>.create`, code non corrigé) ou par un
// client de transaction (`tx.<modele>.create`, code corrigé via `prisma.$transaction`). Patche
// `prisma.$transaction` lui-même pour intercepter le `tx` réel fourni par Prisma avant qu'il
// n'atteigne le callback de production, puis y applique le même compteur. Toujours restauré par
// la fonction retournée, appelée dans un `finally` par chaque test.
function armerPanneCreation(
  nomModele: "ligneDocumentFournisseur" | "ligneVente",
  indexCrashant: number
): () => void {
  let compteur = 0;
  const delegue = prisma[nomModele] as unknown as { create: (...args: unknown[]) => Promise<unknown> };
  const originalCreate = delegue.create.bind(delegue);
  delegue.create = async (...args: unknown[]) => {
    compteur++;
    if (compteur === indexCrashant) {
      throw new Error("PANNE SIMULÉE (test d'atomicité) : échec déterministe confiné aux tests, jamais une panne réelle");
    }
    return originalCreate(...args);
  };

  const originalTransaction = prisma.$transaction.bind(prisma);
  (prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = (async (
    arg: unknown,
    ...reste: unknown[]
  ) => {
    if (typeof arg !== "function") {
      return (originalTransaction as (...a: unknown[]) => unknown)(arg, ...reste);
    }
    return (originalTransaction as (...a: unknown[]) => unknown)(async (tx: unknown) => {
      const txDelegue = (tx as Record<string, { create: (...args: unknown[]) => Promise<unknown> }>)[nomModele];
      const originalTxCreate = txDelegue.create.bind(txDelegue);
      txDelegue.create = async (...args: unknown[]) => {
        compteur++;
        if (compteur === indexCrashant) {
          throw new Error("PANNE SIMULÉE (test d'atomicité) : échec déterministe confiné aux tests, jamais une panne réelle");
        }
        return originalTxCreate(...args);
      };
      return (arg as (tx: unknown) => unknown)(tx);
    }, ...reste);
  }) as typeof prisma.$transaction;

  return () => {
    delegue.create = originalCreate;
    (prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = originalTransaction;
  };
}

before(async () => {
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "atomicite-imports-"));
  process.env.DOCUMENTS_STORAGE_PATH = dossierTemporaire;

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  token = await connecterAdminDeTest(baseUrl);

  const societe =
    (await prisma.societe.findFirst({ orderBy: { id: "asc" } })) ??
    (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;

  const fournisseur = await prisma.fournisseur.create({ data: { nom: `${PREFIXE} Fournisseur ${randomUUID()}`, societeId } });
  fournisseurId = fournisseur.id;

  // Recette réelle pour la ligne VALIDEE du scénario ventes (apprentissage d'alias à vérifier
  // rollback lui aussi).
  recetteAtomiciteNom = `${PREFIXE} Recette ${randomUUID()}`;
  const recette = await prisma.recette.create({ data: { societeId, nom: recetteAtomiciteNom, portions: 1 } });
  recetteAtomiciteId = recette.id;
  recetteIds.push(recette.id);
});

after(async () => {
  await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId } } });
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId } });
  await prisma.fournisseur.delete({ where: { id: fournisseurId } });
  await prisma.ligneVente.deleteMany({ where: { documentVentesId: { in: documentVentesIds } } });
  await prisma.documentVentes.deleteMany({ where: { id: { in: documentVentesIds } } });
  await prisma.aliasProduitVenduImport.deleteMany({ where: { texteNormalise: { contains: "atomicite" } } });
  await prisma.recette.deleteMany({ where: { id: { in: recetteIds } } });
  delete process.env.DOCUMENTS_STORAGE_PATH;
  await fs.rm(dossierTemporaire, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("ATOMICITÉ : POST /listings-fournisseur/:fournisseurId — une panne sur la 2e ligne ne laisse ni document ni ligne", async () => {
  const avantDocs = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const restaurer = armerPanneCreation("ligneDocumentFournisseur", 2);
  let statut: number;
  try {
    const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/${fournisseurId}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        photoDataUrl: PNG_1X1,
        lignes: [
          { designation: `${PREFIXE} Listing L1 ${randomUUID()}`, prix: "1,00" },
          { designation: `${PREFIXE} Listing L2 ${randomUUID()}`, prix: "2,00" },
        ],
      }),
    });
    statut = reponse.status;
  } finally {
    restaurer();
  }
  assert.equal(statut, 500, "la panne simulée doit toujours remonter en 500, jamais masquée");

  const apresDocs = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  assert.equal(apresDocs, avantDocs, "aucun DocumentFournisseur ne doit survivre à une panne mi-boucle");
  const lignesOrphelines = await prisma.ligneDocumentFournisseur.count({ where: { document: { fournisseurId } } });
  assert.equal(lignesOrphelines, 0, "aucune LigneDocumentFournisseur ne doit survivre, y compris celle écrite avant la panne");
});

test("ATOMICITÉ : POST /listings-fournisseur/factures/:fournisseurId — une panne sur la 2e ligne ne laisse ni document ni ligne", async () => {
  const avantDocs = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  const restaurer = armerPanneCreation("ligneDocumentFournisseur", 2);
  let statut: number;
  try {
    const reponse = await fetch(`${baseUrl}/api/listings-fournisseur/factures/${fournisseurId}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        photoDataUrl: PNG_1X1,
        numero: `ATOMICITE-${randomUUID()}`,
        lignes: [
          { designation: `${PREFIXE} Facture L1 ${randomUUID()}`, prix: "1,00" },
          { designation: `${PREFIXE} Facture L2 ${randomUUID()}`, prix: "2,00" },
        ],
      }),
    });
    statut = reponse.status;
  } finally {
    restaurer();
  }
  assert.equal(statut, 500);

  const apresDocs = await prisma.documentFournisseur.count({ where: { fournisseurId } });
  assert.equal(apresDocs, avantDocs, "aucun DocumentFournisseur (facture) ne doit survivre à une panne mi-boucle");
  const lignesOrphelines = await prisma.ligneDocumentFournisseur.count({ where: { document: { fournisseurId } } });
  assert.equal(lignesOrphelines, 0);
});

test("ATOMICITÉ : POST /ventes/import — une panne sur la 2e ligne ne laisse ni document, ni ligne, ni alias appris par la 1ère ligne", async () => {
  const avantDocs = await prisma.documentVentes.count({ where: { societeId } });
  const aliasAvant = await prisma.aliasProduitVenduImport.findUnique({
    where: { texteNormalise: recetteAtomiciteNom.toLowerCase() },
  });
  assert.equal(aliasAvant, null, "pré-condition : aucun alias ne doit déjà exister pour cette recette de test");

  const restaurer = armerPanneCreation("ligneVente", 2);
  let statut: number;
  try {
    const reponse = await fetch(`${baseUrl}/api/ventes/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        lignes: [
          // Ligne 1 : VALIDEE avec une correspondance exacte réelle -> écrit la ligne ET apprend
          // l'alias (2 écritures DB), AVANT la panne.
          { designation: recetteAtomiciteNom, quantite: "1", decision: "VALIDEE", recetteRetenueId: recetteAtomiciteId },
          // Ligne 2 : provoque la panne simulée (2e appel à ligneVente.create).
          { designation: `${PREFIXE} Vente L2 ${randomUUID()}`, quantite: "1", decision: "REJETEE" },
        ],
      }),
    });
    statut = reponse.status;
  } finally {
    restaurer();
  }
  assert.equal(statut, 500);

  const apresDocs = await prisma.documentVentes.count({ where: { societeId } });
  assert.equal(apresDocs, avantDocs, "aucun DocumentVentes ne doit survivre à une panne mi-boucle");

  const lignesOrphelines = await prisma.ligneVente.count({
    where: { documentVentes: { societeId }, designationLue: { in: [recetteAtomiciteNom] } },
  });
  assert.equal(lignesOrphelines, 0, "aucune LigneVente ne doit survivre, y compris celle écrite avant la panne");

  const aliasApres = await prisma.aliasProduitVenduImport.findUnique({
    where: { texteNormalise: recetteAtomiciteNom.toLowerCase() },
  });
  assert.equal(aliasApres, null, "l'alias appris par la 1ère ligne (avant la panne) ne doit pas non plus survivre");
});
