import type { PrismaClient } from "@prisma/client";
import { journaliserErreur } from "../journalErreurs.js";
import { racineStockage } from "../storageDocumentsFournisseur.js";
import { lireConfigSauvegardeExterne, type ConfigSauvegardeExterne } from "./config.js";
import { doitSauvegarder } from "./planification.js";
import { dateSauvegardeBase, PREFIXE_QUOTIDIENNES } from "./nommage.js";
import { envoyerDocuments, sauvegarderBase } from "./sauvegardeExterne.js";
import { StockageS3, type StockageSauvegardes } from "./stockage.js";

// Déclenchement de la sauvegarde hors de Railway (voir sauvegardeExterne.ts), dans le serveur
// lui-même — rien d'autre à installer ni à surveiller chez l'hébergeur : toutes les 15 minutes, on
// regarde si la sauvegarde de la nuit est due (voir planification.ts). Au démarrage, la date de la
// dernière sauvegarde est relue chez l'hébergeur de stockage : un redémarrage ou un déploiement ne
// provoque ni doublon ni oubli. Un échec est inscrit au journal des erreurs (visible du
// propriétaire, Paramètres) et retenté une heure plus tard, jamais en boucle.

const INTERVALLE_MS = 15 * 60_000;
const DELAI_APRES_ECHEC_MS = 3600_000;

export type EtatSauvegardeExterne = {
  configuration: "absente" | "incomplete" | "ok";
  probleme: string | null;
  enCours: boolean;
  // false tant que la dernière sauvegarde n'a pas encore été relue chez l'hébergeur (juste après un
  // démarrage) : derniereReussie est alors inconnue, pas absente.
  derniereConnue: boolean;
  derniereReussie: { le: string; nom: string } | null;
  dernierEchec: { le: string; message: string } | null;
};

export class PlanificateurSauvegardeExterne {
  private enCours = false;
  private derniere: { le: Date; nom: string } | null | undefined = undefined; // undefined : pas encore relue
  private echec: { le: Date; message: string } | null = null;
  private config: ConfigSauvegardeExterne;
  private stockage: StockageSauvegardes | null;

  constructor(
    private deps: {
      prisma: PrismaClient;
      env?: NodeJS.ProcessEnv;
      maintenant?: () => Date;
      stockage?: StockageSauvegardes;
      racineDocuments?: () => string | null;
    }
  ) {
    this.config = lireConfigSauvegardeExterne(deps.env);
    this.stockage = this.config.etat === "ok" ? (deps.stockage ?? new StockageS3(this.config.stockage)) : null;
  }

  private maintenant() {
    return this.deps.maintenant?.() ?? new Date();
  }

  etat(): EtatSauvegardeExterne {
    return {
      configuration: this.config.etat,
      probleme: this.config.etat === "incomplete" ? this.config.probleme : null,
      enCours: this.enCours,
      derniereConnue: this.derniere !== undefined,
      derniereReussie: this.derniere ? { le: this.derniere.le.toISOString(), nom: this.derniere.nom } : null,
      dernierEchec: this.echec ? { le: this.echec.le.toISOString(), message: this.echec.message } : null,
    };
  }

  // Sans DOCUMENTS_STORAGE_PATH en production, racineStockage() lève une erreur : elle est signalée
  // comme un échec des documents, jamais avalée (les documents seraient sinon oubliés en silence).
  private racineDocuments(): string | null {
    return this.deps.racineDocuments ? this.deps.racineDocuments() : racineStockage();
  }

  async tour(): Promise<void> {
    if (this.config.etat !== "ok" || !this.stockage || this.enCours) return;
    const maintenant = this.maintenant();
    if (this.echec && maintenant.getTime() - this.echec.le.getTime() < DELAI_APRES_ECHEC_MS) return;

    this.enCours = true;
    try {
      if (this.derniere === undefined) {
        const plusRecente = (await this.stockage.lister(PREFIXE_QUOTIDIENNES))
          .map((o) => ({ nom: o.nom, le: dateSauvegardeBase(o.nom) }))
          .filter((s): s is { nom: string; le: Date } => s.le !== null)
          .sort((a, b) => b.le.getTime() - a.le.getTime())[0];
        this.derniere = plusRecente ?? null;
      }
      if (!doitSauvegarder(maintenant, this.derniere?.le ?? null)) return;

      const base = await sauvegarderBase({
        prisma: this.deps.prisma,
        stockage: this.stockage,
        clePublique: this.config.clePublique,
        maintenant,
      });
      // La base est sauvée : la nuit compte comme faite, quoi qu'il arrive ensuite aux documents
      // (jamais une nouvelle sauvegarde complète de la base toutes les heures pour un document).
      this.derniere = { le: maintenant, nom: base.nom };
      this.echec = null;
      console.log(`✅ Sauvegarde externe : ${base.nom} (${base.tailleOctets} octets${base.mensuelle ? ", copie mensuelle" : ""}).`);

      try {
        const racine = this.racineDocuments();
        if (racine === null) return;
        const documents = await envoyerDocuments({ stockage: this.stockage, clePublique: this.config.clePublique, racineDocuments: racine });
        if (documents.documentsEchecs.length > 0) {
          throw new Error(`${documents.documentsEchecs.length} document(s) non sauvegardé(s) : ${documents.documentsEchecs.join(" ; ")}`);
        }
        console.log(`✅ Documents fournisseurs : ${documents.documentsEnvoyes}/${documents.documentsTotal} envoyé(s).`);
      } catch (erreur) {
        throw new Error(`Base sauvegardée, mais documents fournisseurs en échec (nouvel essai la nuit prochaine) : ${(erreur as Error).message}`, {
          cause: erreur,
        });
      }
    } catch (erreur) {
      this.echec = { le: maintenant, message: (erreur as Error).message };
      console.error("❌ Sauvegarde externe en échec :", erreur);
      await journaliserErreur(erreur, "SERVEUR", { route: "sauvegarde-externe" });
    } finally {
      this.enCours = false;
    }
  }

  // Signale une seule fois une configuration incomplète, puis vérifie toutes les 15 minutes.
  demarrer(): () => void {
    if (this.config.etat === "absente") {
      console.log("ℹ️ Sauvegarde externe non configurée (variables SAUVEGARDE_*) : désactivée.");
      return () => {};
    }
    if (this.config.etat === "incomplete") {
      const erreur = new Error(`Sauvegarde externe mal configurée : ${this.config.probleme}`);
      console.error(`❌ ${erreur.message}`);
      void journaliserErreur(erreur, "SERVEUR", { route: "sauvegarde-externe" });
      return () => {};
    }
    const lancer = () => void this.tour();
    // Premier passage peu après le démarrage : relit la dernière sauvegarde chez l'hébergeur.
    const premier = setTimeout(lancer, 15_000);
    const minuterie = setInterval(lancer, INTERVALLE_MS);
    premier.unref();
    minuterie.unref();
    return () => {
      clearTimeout(premier);
      clearInterval(minuterie);
    };
  }
}

let instance: PlanificateurSauvegardeExterne | null = null;

export function demarrerSauvegardesExternes(prisma: PrismaClient): () => void {
  instance = new PlanificateurSauvegardeExterne({ prisma });
  return instance.demarrer();
}

// Avant le démarrage (tests, scripts) : seule la configuration est connue.
export function etatSauvegardeExterne(): EtatSauvegardeExterne {
  if (instance) return instance.etat();
  const config = lireConfigSauvegardeExterne();
  return {
    configuration: config.etat,
    probleme: config.etat === "incomplete" ? config.probleme : null,
    enCours: false,
    derniereConnue: false,
    derniereReussie: null,
    dernierEchec: null,
  };
}
