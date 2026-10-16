import { inflateSync } from "node:zlib";

// Texte d'un PDF produit par @react-pdf/renderer (server/utils/pdf/) : flux compressés (FlateDecode),
// chaque segment de texte écrit en hexadécimal dans un opérateur TJ (police standard, octets
// latin1). Suffisant pour vérifier qu'une mention ou un montant figure — ou non — dans le document.
export function texteDuPdf(pdf: Buffer): string {
  const brut = pdf.toString("latin1");
  let contenu = "";
  for (const flux of brut.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      contenu += inflateSync(Buffer.from(flux[1], "latin1")).toString("latin1");
    } catch {
      // Flux non compressé ou binaire (police, image) : sans texte à extraire.
    }
  }
  return [...contenu.matchAll(/\[(.*?)\] TJ/g)]
    .map((tj) => [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], "hex").toString("latin1")).join(""))
    .join("\n");
}
