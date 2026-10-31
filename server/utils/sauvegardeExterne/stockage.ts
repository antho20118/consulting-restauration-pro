import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Stockage des sauvegardes hors de Railway, chez un hébergeur compatible S3 (Scaleway, Backblaze…) :
// les noms manipulés ici sont relatifs ("base/…", "documents/…") ; le préfixe éventuel
// (SAUVEGARDE_S3_PREFIXE, pour partager un même espace entre environnements) est ajouté et retiré
// uniquement dans ce module. Volontairement AUCUNE opération de suppression : l'application n'en a
// ni le droit chez l'hébergeur ni le moyen dans son code (conservation : voir nommage.ts).

export type ObjetStocke = { nom: string; tailleOctets: number };

export interface StockageSauvegardes {
  deposer(nom: string, contenu: Buffer): Promise<void>;
  lire(nom: string): Promise<Buffer>;
  lister(prefixe: string): Promise<ObjetStocke[]>;
}

export type ConfigStockageS3 = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefixe: string;
};

export class StockageS3 implements StockageSauvegardes {
  private client: S3Client;

  constructor(private config: ConfigStockageS3) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Adresse « hébergeur/espace/fichier » : comprise de tous les hébergeurs compatibles S3.
      forcePathStyle: true,
      // Sommes de contrôle ajoutées d'office par les versions récentes du kit AWS : refusées par
      // plusieurs hébergeurs compatibles S3 (dont Scaleway et Backblaze, qui le documentent) —
      // seulement quand l'opération l'exige. L'intégrité est de toute façon garantie par le
      // chiffrement authentifié et la relecture après dépôt (voir sauvegardeExterne.ts).
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  private cle(nom: string) {
    return `${this.config.prefixe}${nom}`;
  }

  async deposer(nom: string, contenu: Buffer) {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: this.cle(nom), Body: contenu }));
  }

  async lire(nom: string) {
    const reponse = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: this.cle(nom) }));
    return Buffer.from(await reponse.Body!.transformToByteArray());
  }

  async lister(prefixe: string) {
    const objets: ObjetStocke[] = [];
    let suite: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: this.cle(prefixe), ContinuationToken: suite })
      );
      for (const o of page.Contents ?? []) {
        if (o.Key) objets.push({ nom: o.Key.slice(this.config.prefixe.length), tailleOctets: o.Size ?? 0 });
      }
      suite = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (suite);
    return objets;
  }
}
