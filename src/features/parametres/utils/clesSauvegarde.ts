// Fabrication de la paire de clés de chiffrement des sauvegardes hors de Railway (voir
// server/utils/sauvegardeExterne/chiffrement.ts), ENTIÈREMENT dans le navigateur (WebCrypto) : rien
// n'est jamais envoyé au serveur. La clé publique (qui ne sait que chiffrer) va dans les variables
// Railway ; la clé privée (seule à pouvoir déchiffrer) reste chez le propriétaire — gestionnaire de
// mots de passe et copie papier —, jamais dans Railway : une fuite des variables Railway ne permet
// alors de lire aucune sauvegarde.
//
// RSA-OAEP 4096 bits, SHA-256 — exactement les paramètres attendus côté serveur et par l'outil de
// récupération. Clés exportées en base64 sur une seule ligne (SPKI pour la publique, PKCS#8 pour la
// privée), faciles à coller dans une variable d'environnement ou une note.

export type PaireClesSauvegarde = { clePublique: string; clePrivee: string };

function enBase64(octets: ArrayBuffer): string {
  const tableau = new Uint8Array(octets);
  let binaire = "";
  for (let i = 0; i < tableau.length; i++) binaire += String.fromCharCode(tableau[i]);
  return btoa(binaire);
}

export async function genererPaireClesSauvegarde(): Promise<PaireClesSauvegarde> {
  const paire = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );
  return {
    clePublique: enBase64(await crypto.subtle.exportKey("spki", paire.publicKey)),
    clePrivee: enBase64(await crypto.subtle.exportKey("pkcs8", paire.privateKey)),
  };
}
