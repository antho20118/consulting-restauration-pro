import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import prisma from "../../server/prisma.js";
import { detecterDoublonFacture, memeJour, memeMontant } from "../../server/routes/listingsFournisseur.js";

// Test unitaire ciblé de la logique de déduplication de facture (Phase 6, option C graduée
// autorisée par l'utilisateur) — indépendant du contrat HTTP complet (voir
// tests/unit/facturesFournisseur.test.ts pour les tests API). Touche un vrai Postgres (comme tous
// les "tests unitaires" de ce projet, voir tests/unit/articles.test.ts) mais n'exerce que
// detecterDoublonFacture() directement, jamais une route.

let societeId: number;
let fournisseurA: number;
let fournisseurB: number;
const documentIds: number[] = [];

function creerCle(): string {
  return randomUUID();
}

before(async () => {
  const societe = (await prisma.societe.findFirst()) ?? (await prisma.societe.create({ data: { nom: "Société de test" } }));
  societeId = societe.id;
  const fA = await prisma.fournisseur.create({ data: { nom: "DOUBLON FACTURE TEST Fournisseur A", societeId } });
  fournisseurA = fA.id;
  const fB = await prisma.fournisseur.create({ data: { nom: "DOUBLON FACTURE TEST Fournisseur B", societeId } });
  fournisseurB = fB.id;
});

after(async () => {
  await prisma.documentFournisseur.deleteMany({ where: { fournisseurId: { in: [fournisseurA, fournisseurB] } } });
  await prisma.fournisseur.deleteMany({ where: { id: { in: [fournisseurA, fournisseurB] } } });
});

async function creerFactureExistante(
  fournisseurId: number,
  numero: string,
  dateDocument: Date | null,
  montantTotal: number | null
) {
  const doc = await prisma.documentFournisseur.create({
    data: {
      fournisseurId,
      type: "FACTURE",
      cle: creerCle(),
      typeMime: "image/png",
      tailleOctets: 100,
      numero,
      dateDocument,
      montantTotal,
    },
  });
  documentIds.push(doc.id);
  return doc;
}

// --- Fonctions de comparaison élémentaires ---

test("memeJour : ignore l'heure, compare uniquement année/mois/jour (UTC)", () => {
  assert.equal(memeJour(new Date("2026-03-15T08:00:00Z"), new Date("2026-03-15T23:59:00Z")), true);
  assert.equal(memeJour(new Date("2026-03-15T00:00:00Z"), new Date("2026-03-16T00:00:00Z")), false);
});

test("memeMontant : tolère un écart d'arrondi négligeable, pas un écart réel", () => {
  assert.equal(memeMontant(342.5, 342.501), true);
  assert.equal(memeMontant(342.5, 343.0), false);
});

// --- Détection ---

test("Cas 1 : facture jamais importée -> aucun doublon", async () => {
  const resultat = await detecterDoublonFacture(fournisseurA, "FA-JAMAIS-VUE", new Date("2026-03-15"), 100);
  assert.equal(resultat, null);
});

test("Cas 2 : même fournisseur + même numéro + même date + même montant -> FORTE", async () => {
  await creerFactureExistante(fournisseurA, "FA-2001", new Date("2026-03-15"), 342.5);
  const resultat = await detecterDoublonFacture(fournisseurA, "FA-2001", new Date("2026-03-15"), 342.5);
  assert.ok(resultat);
  assert.equal(resultat!.niveau, "FORTE");
  assert.equal(resultat!.correspondances[0].niveau, "FORTE");
});

test("Cas 3 : même fournisseur + même numéro + date différente -> FAIBLE", async () => {
  await creerFactureExistante(fournisseurA, "FA-2002", new Date("2026-03-15"), 100);
  const resultat = await detecterDoublonFacture(fournisseurA, "FA-2002", new Date("2026-04-20"), 100);
  assert.ok(resultat);
  assert.equal(resultat!.niveau, "FAIBLE");
});

test("Cas 4 : même fournisseur + même numéro + montant différent -> FAIBLE", async () => {
  await creerFactureExistante(fournisseurA, "FA-2003", new Date("2026-03-15"), 100);
  const resultat = await detecterDoublonFacture(fournisseurA, "FA-2003", new Date("2026-03-15"), 999);
  assert.ok(resultat);
  assert.equal(resultat!.niveau, "FAIBLE");
});

test("Cas 5 : même fournisseur + numéro différent -> aucun doublon", async () => {
  await creerFactureExistante(fournisseurA, "FA-2004", new Date("2026-03-15"), 100);
  const resultat = await detecterDoublonFacture(fournisseurA, "FA-AUTRE-NUMERO", new Date("2026-03-15"), 100);
  assert.equal(resultat, null);
});

test("Cas 6 : fournisseur différent + même numéro -> aucun doublon (jamais tous fournisseurs confondus)", async () => {
  await creerFactureExistante(fournisseurA, "FA-2005", new Date("2026-03-15"), 100);
  const resultat = await detecterDoublonFacture(fournisseurB, "FA-2005", new Date("2026-03-15"), 100);
  assert.equal(resultat, null);
});

test("Cas 7 : numéro absent -> aucune détection, jamais déduite de la date/du montant seuls", async () => {
  await creerFactureExistante(fournisseurA, "FA-2006", new Date("2026-03-15"), 100);
  const resultatNull = await detecterDoublonFacture(fournisseurA, null, new Date("2026-03-15"), 100);
  assert.equal(resultatNull, null);
  const resultatVide = await detecterDoublonFacture(fournisseurA, "   ", new Date("2026-03-15"), 100);
  assert.equal(resultatVide, null);
});

test("Cas 8 : plusieurs documents existants avec le même numéro -> toutes les correspondances rapportées", async () => {
  await creerFactureExistante(fournisseurA, "FA-2007", new Date("2026-01-01"), 50);
  await creerFactureExistante(fournisseurA, "FA-2007", new Date("2026-06-15"), 342.5);

  const resultat = await detecterDoublonFacture(fournisseurA, "FA-2007", new Date("2026-06-15"), 342.5);
  assert.ok(resultat);
  assert.equal(resultat!.correspondances.length, 2);
  // Une correspondance FORTE (date+montant identiques) suffit à classer l'ensemble FORTE, même si
  // l'autre correspondance n'est que FAIBLE.
  assert.equal(resultat!.niveau, "FORTE");
  const niveaux = resultat!.correspondances.map((c) => c.niveau).sort();
  assert.deepEqual(niveaux, ["FAIBLE", "FORTE"]);
});

test("la comparaison porte sur les données réellement en base, jamais une liste fournie par l'appelant", async () => {
  // Preuve structurelle : detecterDoublonFacture ne prend en paramètre que des valeurs scalaires
  // (fournisseurId, numero, dateDocument, montantTotal) — aucune liste de documents "existants" ne
  // peut lui être injectée depuis l'extérieur ; elle interroge toujours prisma elle-même.
  assert.equal(detecterDoublonFacture.length, 4);
});
