import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { StockageS3 } from "../../server/utils/sauvegardeExterne/stockage.js";

// Dialogue réel avec un hébergeur compatible S3 (Scaleway, Backblaze…), joué par un faux hébergeur
// local qui répond comme eux : requêtes signées avec la clé d'accès, adresse « espace/fichier »,
// liste paginée, préfixe d'environnement ajouté et retiré, et contenu déposé tel quel — sans le
// découpage « aws-chunked » ni les sommes de contrôle ajoutées d'office par les versions récentes du
// kit AWS, que plusieurs hébergeurs compatibles S3 refusent (voir StockageS3).

const objets = new Map<string, Buffer>();
const requetes: { methode: string; url: string; autorisation: string; encodage: string | undefined; sommesControle: string[] }[] = [];
let serveur: http.Server;
let stockage: StockageS3;

function echapper(texte: string) {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

before(async () => {
  serveur = http.createServer((req, res) => {
    const morceaux: Buffer[] = [];
    req.on("data", (m) => morceaux.push(m));
    req.on("end", () => {
      const url = new URL(req.url!, "http://local");
      requetes.push({
        methode: req.method!,
        url: req.url!,
        autorisation: String(req.headers.authorization),
        encodage: req.headers["content-encoding"],
        sommesControle: Object.keys(req.headers).filter((h) => h.startsWith("x-amz-checksum") || h === "x-amz-sdk-checksum-algorithm"),
      });
      const [, espace, ...reste] = url.pathname.split("/");
      const cle = decodeURIComponent(reste.join("/"));
      if (espace !== "mes-sauvegardes") return void res.writeHead(404).end();
      if (req.method === "PUT") {
        objets.set(cle, Buffer.concat(morceaux));
        return void res.writeHead(200, { ETag: '"x"' }).end();
      }
      if (req.method === "DELETE") {
        objets.delete(cle);
        return void res.writeHead(204).end();
      }
      if (req.method === "GET" && cle) {
        const contenu = objets.get(cle);
        if (!contenu) return void res.writeHead(404, { "Content-Type": "application/xml" }).end("<Error><Code>NoSuchKey</Code></Error>");
        return void res.writeHead(200, { "Content-Length": contenu.length }).end(contenu);
      }
      // Liste paginée par 2, comme un hébergeur qui renvoie ses résultats en plusieurs pages.
      const prefixe = url.searchParams.get("prefix") ?? "";
      const cles = [...objets.keys()].filter((k) => k.startsWith(prefixe)).sort();
      const depart = Number(url.searchParams.get("continuation-token") ?? 0);
      const page = cles.slice(depart, depart + 2);
      const tronque = depart + 2 < cles.length;
      res.writeHead(200, { "Content-Type": "application/xml" }).end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>mes-sauvegardes</Name><Prefix>${echapper(prefixe)}</Prefix>` +
          `<IsTruncated>${tronque}</IsTruncated>${tronque ? `<NextContinuationToken>${depart + 2}</NextContinuationToken>` : ""}` +
          page.map((k) => `<Contents><Key>${echapper(k)}</Key><Size>${objets.get(k)!.length}</Size></Contents>`).join("") +
          `</ListBucketResult>`
      );
    });
  });
  await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", r));
  stockage = new StockageS3({
    endpoint: `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`,
    region: "fr-par",
    bucket: "mes-sauvegardes",
    accessKeyId: "CLE-ACCES-TEST",
    secretAccessKey: "secret-test",
    prefixe: "production/",
  });
});

after(() => new Promise<void>((r) => serveur.close(() => r())));

test("dépôt, relecture et liste paginée sous le préfixe de l'environnement — jamais de suppression", async () => {
  const contenu = Buffer.from([0, 1, 2, 250, 251, 252]);
  for (const n of ["base/a.chiffre", "base/b.chiffre", "base/c.chiffre", "documents/fournisseurs/1/x.pdf.chiffre"]) {
    await stockage.deposer(n, contenu);
  }
  assert.ok(objets.has("production/base/a.chiffre"), "préfixe d'environnement ajouté");
  assert.deepEqual(objets.get("production/base/a.chiffre"), contenu, "contenu déposé tel quel, octet pour octet");
  assert.deepEqual(await stockage.lire("base/b.chiffre"), contenu);

  const liste = await stockage.lister("base/");
  assert.deepEqual(liste.map((o) => o.nom), ["base/a.chiffre", "base/b.chiffre", "base/c.chiffre"], "toutes les pages, préfixe retiré");
  assert.equal(liste[0].tailleOctets, contenu.length);

  await assert.rejects(stockage.lire("base/absent.chiffre"));

  // Aucune suppression possible : ni méthode pour le faire, ni requête DELETE jamais envoyée.
  assert.equal("supprimer" in stockage, false);
  assert.ok(requetes.every((r) => r.methode !== "DELETE"));

  assert.ok(requetes.every((r) => r.autorisation.startsWith("AWS4-HMAC-SHA256 Credential=CLE-ACCES-TEST/")), "requêtes signées");
  assert.ok(requetes.every((r) => !r.encodage?.includes("aws-chunked")), "jamais de découpage aws-chunked");
  assert.deepEqual(requetes.flatMap((r) => r.sommesControle), [], "aucune somme de contrôle propre à AWS");
});
