import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  enregistrerDocument,
  lireDocument,
  supprimerDocument,
  DocumentInvalideError,
  TAILLE_MAX_OCTETS,
} from "../../server/utils/storageDocumentsFournisseur.js";

// Test unitaire pur (aucun serveur HTTP, aucun Postgres) du module de stockage des documents
// fournisseurs — voir server/utils/storageDocumentsFournisseur.ts, Phase 1 du chantier
// listings/factures. DOCUMENTS_STORAGE_PATH est redirigé vers un dossier temporaire isolé, jamais
// vers data-dev/ (partagé) ni vers un vrai Railway Volume.

let dossierTemporaire: string;

before(async () => {
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "storage-documents-test-"));
  process.env.DOCUMENTS_STORAGE_PATH = dossierTemporaire;
});

after(async () => {
  delete process.env.DOCUMENTS_STORAGE_PATH;
  await fs.rm(dossierTemporaire, { recursive: true, force: true });
});

// PNG 1x1 transparent réel (68 octets), pas un stub : signature binaire authentique, vérifiée
// indépendamment avant écriture de ce test (voir la commande node exécutée en amont).
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("écrit un document PNG réel puis le relit à l'identique", async () => {
  const stocke = await enregistrerDocument({
    fournisseurId: 42,
    dataUrl: PNG_1X1,
    nomFichierOriginal: "listing-super-u.png",
  });

  assert.match(stocke.cle, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(stocke.typeMime, "image/png");
  assert.equal(stocke.tailleOctets, 68);
  assert.equal(stocke.nomFichierOriginal, "listing-super-u.png");

  const lu = await lireDocument(42, stocke.cle);
  assert.ok(lu, "le document vient d'être écrit, il doit être relisible");
  assert.equal(lu!.typeMime, "image/png");
  assert.equal(lu!.buffer.length, 68);
  assert.equal(Buffer.from(PNG_1X1.split(",")[1], "base64").equals(lu!.buffer), true);
});

test("range le fichier sous fournisseurs/<id>/ et jamais ailleurs", async () => {
  const stocke = await enregistrerDocument({ fournisseurId: 7, dataUrl: PNG_1X1 });

  const cheminAttendu = path.join(dossierTemporaire, "fournisseurs", "7", `${stocke.cle}.png`);
  await assert.doesNotReject(fs.access(cheminAttendu));
});

test("rejette un type de fichier non reconnu (signature binaire invalide)", async () => {
  const texteBrut = Buffer.from("ceci n'est pas une image").toString("base64");

  await assert.rejects(
    enregistrerDocument({ fournisseurId: 1, dataUrl: `data:text/plain;base64,${texteBrut}` }),
    DocumentInvalideError
  );
});

test("rejette un document dépassant la taille maximale, même avec une signature valide", async () => {
  const octetsTropGrands = Buffer.alloc(TAILLE_MAX_OCTETS + 1024, 0);
  // Signature PNG valide en tête, mais la taille doit être refusée avant même l'inspection du
  // contenu — voir l'ordre des vérifications dans enregistrerDocument.
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(octetsTropGrands);
  const dataUrl = `data:image/png;base64,${octetsTropGrands.toString("base64")}`;

  await assert.rejects(enregistrerDocument({ fournisseurId: 1, dataUrl }), DocumentInvalideError);
});

test("rejette un fournisseurId invalide (défense en profondeur, jamais fourni tel quel par une route réelle)", async () => {
  await assert.rejects(enregistrerDocument({ fournisseurId: -1, dataUrl: PNG_1X1 }), DocumentInvalideError);
  await assert.rejects(enregistrerDocument({ fournisseurId: 1.5, dataUrl: PNG_1X1 }), DocumentInvalideError);
  await assert.rejects(lireDocument(0, "00000000-0000-4000-8000-000000000000"), DocumentInvalideError);
  await assert.rejects(supprimerDocument(-5, "00000000-0000-4000-8000-000000000000"), DocumentInvalideError);
});

test("rejette une clé mal formée (tentative de traversal via le paramètre clé)", async () => {
  await assert.rejects(lireDocument(42, "../../../etc/passwd"), DocumentInvalideError);
  await assert.rejects(lireDocument(42, "..%2f..%2fetc%2fpasswd"), DocumentInvalideError);
});

test("lireDocument renvoie null pour un document inexistant (jamais une exception)", async () => {
  const resultat = await lireDocument(999, "00000000-0000-4000-8000-000000000000");
  assert.equal(resultat, null);
});

test("supprimerDocument est idempotente sur un document déjà absent", async () => {
  await assert.doesNotReject(supprimerDocument(999, "00000000-0000-4000-8000-000000000000"));
});

test("supprimerDocument efface réellement un document existant", async () => {
  const stocke = await enregistrerDocument({ fournisseurId: 55, dataUrl: PNG_1X1 });
  assert.ok(await lireDocument(55, stocke.cle));

  await supprimerDocument(55, stocke.cle);

  assert.equal(await lireDocument(55, stocke.cle), null);
});

test("refuse d'écrire en production sans DOCUMENTS_STORAGE_PATH configuré", async () => {
  const ancienneValeur = process.env.DOCUMENTS_STORAGE_PATH;
  const ancienNodeEnv = process.env.NODE_ENV;
  delete process.env.DOCUMENTS_STORAGE_PATH;
  process.env.NODE_ENV = "production";

  try {
    await assert.rejects(
      enregistrerDocument({ fournisseurId: 1, dataUrl: PNG_1X1 }),
      /DOCUMENTS_STORAGE_PATH doit être défini en production/
    );
  } finally {
    process.env.NODE_ENV = ancienNodeEnv;
    process.env.DOCUMENTS_STORAGE_PATH = ancienneValeur;
  }
});
