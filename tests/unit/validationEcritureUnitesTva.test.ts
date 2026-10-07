import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { connecterSuperAdminDeTest } from "../helpers/auth.js";

// PR B de l'audit F09/F10 : unites.ts et tva.ts (référentiels partagés entre toutes les sociétés,
// écriture réservée à autoriserEcritureSuperAdmin — voir ce middleware) n'appliquaient AUCUNE
// validation sur le corps des requêtes POST/PUT : nom/symbole/type/facteurBase (unites.ts) et
// nom/taux (tva.ts) étaient déstructurés puis transmis directement à Prisma, sans aucun garde-fou
// applicatif. Impact direct : facteurBase et taux interviennent dans tous les calculs de coût/prix
// de toutes les sociétés (voir server/utils/uniteConversion.ts::versUniteBase) — une valeur
// aberrante acceptée ici (facteurBase<=0, type hors énumération, taux hors [0,100]) corromprait
// silencieusement ces calculs pour tout le monde, bien après l'écriture elle-même.
//
// Vrai serveur Express, vrai jeton superAdmin (voir sauvegardesRoute.test.ts pour le même
// principe) : jamais de mock de req/res, jamais d'appel direct au handler.

let server: Server;
let baseUrl: string;
let token: string;

function authHeaders() {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
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
  token = await connecterSuperAdminDeTest(baseUrl);
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

// --- unites.ts ---

test("POST /api/unites : 400 si facteurBase <= 0, jamais de création (aujourd'hui accepté à tort)", async () => {
  const nom = `Unité invalide ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/unites`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom, symbole: "u-inv", type: "poids", facteurBase: -1 }),
  });
  assert.equal(reponse.status, 400);

  const creee = await prisma.unite.findFirst({ where: { nom } });
  assert.equal(creee, null, "aucune unité ne doit être créée avec un facteurBase invalide");
});

test("POST /api/unites : 400 si type hors énumération poids/volume/unite (aujourd'hui accepté à tort)", async () => {
  const nom = `Unité type invalide ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/unites`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom, symbole: "u-type", type: "longueur", facteurBase: 1 }),
  });
  assert.equal(reponse.status, 400);

  const creee = await prisma.unite.findFirst({ where: { nom } });
  assert.equal(creee, null, "aucune unité ne doit être créée avec un type hors énumération");
});

test("POST /api/unites : 400 si nom vide (aujourd'hui accepté à tort)", async () => {
  const reponse = await fetch(`${baseUrl}/api/unites`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom: "", symbole: `u-vide-${randomUUID()}`, type: "poids", facteurBase: 1 }),
  });
  assert.equal(reponse.status, 400);
});

test("POST /api/unites : 201 avec un corps valide (comportement existant inchangé)", async () => {
  const nom = `Kilogramme de test ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/unites`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom, symbole: "kg-test", type: "poids", facteurBase: 1000 }),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  assert.equal(corps.nom, nom);

  await prisma.unite.delete({ where: { id: corps.id } });
});

test("PUT /api/unites/:id : 400 si facteurBase <= 0, aucune modification appliquée (aujourd'hui accepté à tort)", async () => {
  const unite = await prisma.unite.create({
    data: { nom: "Unité PUT test", symbole: "u-put", type: "poids", facteurBase: 1 },
  });
  try {
    const reponse = await fetch(`${baseUrl}/api/unites/${unite.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ nom: unite.nom, symbole: unite.symbole, type: unite.type, facteurBase: 0 }),
    });
    assert.equal(reponse.status, 400);

    const relue = await prisma.unite.findUniqueOrThrow({ where: { id: unite.id } });
    assert.equal(relue.facteurBase, 1, "la valeur en base ne doit pas avoir changé");
  } finally {
    await prisma.unite.delete({ where: { id: unite.id } });
  }
});

// Avant ce chantier, un PUT partiel (ex. ne modifier que facteurBase) fonctionnait de fait : les
// champs absents du corps devenaient `undefined` après déstructuration, et Prisma ignore un champ
// `undefined` dans `data` (ne le modifie pas), contrairement à `null`. Le schéma complet utilisé au
// départ pour POST et PUT cassait silencieusement ce contrat réel (tout PUT partiel devenait 400) —
// correction : PUT utilise désormais un schéma partiel dédié (voir schemaModification plus bas dans
// unites.ts), qui exige au moins un champ reconnu.

test("PUT /api/unites/:id : un corps partiel (seul facteurBase) reste accepté — comportement historique à préserver", async () => {
  const unite = await prisma.unite.create({
    data: { nom: "Unité PUT partiel", symbole: "u-part", type: "poids", facteurBase: 1 },
  });
  try {
    const reponse = await fetch(`${baseUrl}/api/unites/${unite.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ facteurBase: 500 }),
    });
    assert.equal(reponse.status, 200);

    const relue = await prisma.unite.findUniqueOrThrow({ where: { id: unite.id } });
    assert.equal(relue.facteurBase, 500);
    assert.equal(relue.nom, "Unité PUT partiel", "les champs non fournis ne doivent pas être affectés");
    assert.equal(relue.symbole, "u-part");
    assert.equal(relue.type, "poids");
  } finally {
    await prisma.unite.delete({ where: { id: unite.id } });
  }
});

test("PUT /api/unites/:id : corps vide {} refusé en 400 (aucun champ reconnu)", async () => {
  const unite = await prisma.unite.create({
    data: { nom: "Unité PUT vide", symbole: "u-vide", type: "poids", facteurBase: 1 },
  });
  try {
    const reponse = await fetch(`${baseUrl}/api/unites/${unite.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    assert.equal(reponse.status, 400);
  } finally {
    await prisma.unite.delete({ where: { id: unite.id } });
  }
});

test("POST /api/unites : 400 si une clé inconnue est présente (schéma strict)", async () => {
  const nom = `Unité clé inconnue ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/unites`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom, symbole: "u-inc", type: "poids", facteurBase: 1, champInconnu: "x" }),
  });
  assert.equal(reponse.status, 400);

  const creee = await prisma.unite.findFirst({ where: { nom } });
  assert.equal(creee, null, "aucune unité ne doit être créée si le corps contient une clé inconnue");
});

test("PUT /api/unites/:id : 400 si une clé inconnue est présente, même avec un champ valide (schéma strict)", async () => {
  const unite = await prisma.unite.create({
    data: { nom: "Unité clé inconnue PUT", symbole: "u-inc-put", type: "poids", facteurBase: 1 },
  });
  try {
    const reponse = await fetch(`${baseUrl}/api/unites/${unite.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ facteurBase: 999, champInconnu: "x" }),
    });
    assert.equal(reponse.status, 400);

    const relue = await prisma.unite.findUniqueOrThrow({ where: { id: unite.id } });
    assert.equal(relue.facteurBase, 1, "la valeur en base ne doit pas avoir changé");
  } finally {
    await prisma.unite.delete({ where: { id: unite.id } });
  }
});

// --- tva.ts ---

test("POST /api/tva : 400 si taux négatif (aujourd'hui accepté à tort)", async () => {
  const nom = `TVA négative ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/tva`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom, taux: -5 }),
  });
  assert.equal(reponse.status, 400);

  const creee = await prisma.tVA.findFirst({ where: { nom } });
  assert.equal(creee, null, "aucune TVA ne doit être créée avec un taux négatif");
});

test("POST /api/tva : 400 si taux > 100 (aujourd'hui accepté à tort)", async () => {
  const nom = `TVA excessive ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/tva`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom, taux: 150 }),
  });
  assert.equal(reponse.status, 400);

  const creee = await prisma.tVA.findFirst({ where: { nom } });
  assert.equal(creee, null, "aucune TVA ne doit être créée avec un taux > 100");
});

test("POST /api/tva : 201 avec un corps valide (comportement existant inchangé)", async () => {
  const nom = `TVA de test ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/tva`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom, taux: 5.5 }),
  });
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  assert.equal(corps.taux, 5.5);

  await prisma.tVA.delete({ where: { id: corps.id } });
});

test("PUT /api/tva/:id : 400 si taux > 100, aucune modification appliquée (aujourd'hui accepté à tort)", async () => {
  const tva = await prisma.tVA.create({ data: { nom: "TVA PUT test", taux: 20 } });
  try {
    const reponse = await fetch(`${baseUrl}/api/tva/${tva.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ nom: tva.nom, taux: 200 }),
    });
    assert.equal(reponse.status, 400);

    const relue = await prisma.tVA.findUniqueOrThrow({ where: { id: tva.id } });
    assert.equal(relue.taux, 20, "la valeur en base ne doit pas avoir changé");
  } finally {
    await prisma.tVA.delete({ where: { id: tva.id } });
  }
});

test("PUT /api/tva/:id : un corps partiel (seul taux) reste accepté — comportement historique à préserver", async () => {
  const tva = await prisma.tVA.create({ data: { nom: "TVA PUT partiel", taux: 10 } });
  try {
    const reponse = await fetch(`${baseUrl}/api/tva/${tva.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ taux: 8 }),
    });
    assert.equal(reponse.status, 200);

    const relue = await prisma.tVA.findUniqueOrThrow({ where: { id: tva.id } });
    assert.equal(relue.taux, 8);
    assert.equal(relue.nom, "TVA PUT partiel", "le champ non fourni ne doit pas être affecté");
  } finally {
    await prisma.tVA.delete({ where: { id: tva.id } });
  }
});

test("PUT /api/tva/:id : corps vide {} refusé en 400 (aucun champ reconnu)", async () => {
  const tva = await prisma.tVA.create({ data: { nom: "TVA PUT vide", taux: 10 } });
  try {
    const reponse = await fetch(`${baseUrl}/api/tva/${tva.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    assert.equal(reponse.status, 400);
  } finally {
    await prisma.tVA.delete({ where: { id: tva.id } });
  }
});

test("POST /api/tva : 400 si une clé inconnue est présente (schéma strict)", async () => {
  const nom = `TVA clé inconnue ${randomUUID()}`;
  const reponse = await fetch(`${baseUrl}/api/tva`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ nom, taux: 10, champInconnu: "x" }),
  });
  assert.equal(reponse.status, 400);

  const creee = await prisma.tVA.findFirst({ where: { nom } });
  assert.equal(creee, null, "aucune TVA ne doit être créée si le corps contient une clé inconnue");
});

test("PUT /api/tva/:id : 400 si une clé inconnue est présente, même avec un champ valide (schéma strict)", async () => {
  const tva = await prisma.tVA.create({ data: { nom: "TVA clé inconnue PUT", taux: 10 } });
  try {
    const reponse = await fetch(`${baseUrl}/api/tva/${tva.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ taux: 15, champInconnu: "x" }),
    });
    assert.equal(reponse.status, 400);

    const relue = await prisma.tVA.findUniqueOrThrow({ where: { id: tva.id } });
    assert.equal(relue.taux, 10, "la valeur en base ne doit pas avoir changé");
  } finally {
    await prisma.tVA.delete({ where: { id: tva.id } });
  }
});
