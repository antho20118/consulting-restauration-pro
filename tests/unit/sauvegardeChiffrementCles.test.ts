import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { genererPaireClesSauvegarde } from "../../src/features/parametres/utils/clesSauvegarde.js";
import {
  chiffrer,
  dechiffrer,
  CleInvalideError,
  DechiffrementImpossibleError,
  lireClePublique,
} from "../../server/utils/sauvegardeExterne/chiffrement.js";

// Chiffrement des sauvegardes à DEUX clés (voir chiffrement.ts) : jusqu'ici, la phrase qui chiffrait
// les sauvegardes était aussi celle qui les déchiffrait, et elle était rangée dans les variables
// Railway à côté des clés de l'hébergeur — une fuite comme celle du 21/10 donnait à la fois l'accès
// aux sauvegardes et de quoi les lire. Désormais, Railway ne détient que la clé PUBLIQUE, qui sait
// chiffrer mais jamais déchiffrer ; la clé PRIVÉE reste chez le propriétaire.

test("clés fabriquées dans le navigateur : chiffrées par le serveur, déchiffrées par la seule clé privée", async () => {
  const { clePublique, clePrivee } = await genererPaireClesSauvegarde();
  const contenu = Buffer.from(JSON.stringify({ recette: "Blanquette de veau maison", prix: 12.5 }));
  const chiffre = chiffrer(contenu, clePublique);
  assert.ok(!chiffre.includes(Buffer.from("Blanquette")), "jamais en clair");
  assert.deepEqual(dechiffrer(chiffre, clePrivee), contenu);
  assert.notDeepEqual(chiffrer(contenu, clePublique), chiffre, "chaque fichier a sa propre clé de session");
});

test("la clé publique (seule présente sur Railway) ne permet pas de déchiffrer", async () => {
  const { clePublique } = await genererPaireClesSauvegarde();
  const chiffre = chiffrer(Buffer.from("données"), clePublique);
  assert.throws(() => dechiffrer(chiffre, clePublique));
});

test("mauvaise clé privée, fichier altéré ou étranger : refusé, jamais un contenu faux", async () => {
  const a = await genererPaireClesSauvegarde();
  const b = await genererPaireClesSauvegarde();
  const chiffre = chiffrer(Buffer.from("données"), a.clePublique);
  assert.throws(() => dechiffrer(chiffre, b.clePrivee), DechiffrementImpossibleError);
  const altere = Buffer.from(chiffre);
  altere[altere.length - 1] ^= 0xff;
  assert.throws(() => dechiffrer(altere, a.clePrivee), DechiffrementImpossibleError);
  assert.throws(() => dechiffrer(Buffer.from("pas une sauvegarde"), a.clePrivee), DechiffrementImpossibleError);
});

test("clé publique : refusée si illisible, privée à la place, ou trop courte (moins de 3072 bits)", async () => {
  const { clePublique, clePrivee } = await genererPaireClesSauvegarde();
  assert.doesNotThrow(() => lireClePublique(clePublique));
  assert.doesNotThrow(() => lireClePublique(`-----BEGIN PUBLIC KEY-----\n${clePublique}\n-----END PUBLIC KEY-----`), "format PEM accepté aussi");
  assert.throws(() => lireClePublique("pas-une-cle"), CleInvalideError);
  assert.throws(() => lireClePublique(clePrivee), CleInvalideError);
  const courte = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
  assert.throws(() => lireClePublique(courte), CleInvalideError);
});
