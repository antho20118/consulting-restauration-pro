import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import {
  restaurer,
  lireEtValiderSauvegarde,
  verifierCibleVierge,
  resoudreUrlCible,
  construireDossierMigrationsTronque,
  SauvegardeInvalideError,
  CibleNonVierge,
} from "../../prisma/restaurer.js";

// F08 de l'audit forensique : tests réels (vrai Postgres, vraies migrations rejouées, vraies bases
// créées/détruites) du mécanisme de restauration — jamais une simple vérification que le script
// compile. Chaque base utilisée ici est une base dédiée aux tests, jamais la base partagée
// "consulting" des autres fichiers de test (voir creerBaseTest ci-dessous) : aucun risque de
// collision avec le reste de la suite exécutée en parallèle (node --test isole chaque fichier dans
// son propre processus, voir tests/unit/erreursEcritureFK.test.ts pour le même principe appliqué
// ailleurs dans ce projet).

function urlServeur(): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = "/postgres";
  return u.toString();
}

function urlBase(nom: string): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${nom}`;
  return u.toString();
}

async function creerBaseTest(nom: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: urlServeur() } } });
  try {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${nom}"`);
  } finally {
    await prisma.$disconnect();
  }
}

async function supprimerBaseTest(nom: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: urlServeur() } } });
  try {
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nom}" WITH (FORCE)`);
  } finally {
    await prisma.$disconnect();
  }
}

async function migrerBase(nom: string): Promise<void> {
  const resultat = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: urlBase(nom) },
    encoding: "utf8",
  });
  assert.equal(resultat.status, 0, `migrate deploy a échoué sur ${nom} : ${resultat.stderr}`);
}

const basesACreer: string[] = [];
async function nouvelleBaseMigree(prefixe: string): Promise<string> {
  const nom = `${prefixe}_${randomUUID().replace(/-/g, "")}`;
  await creerBaseTest(nom);
  basesACreer.push(nom);
  await migrerBase(nom);
  return nom;
}

let dossierTemp: string;
let fichierSauvegardeReelle: string;
let baseSource: string;
let idSocieteSource: number;
let idParentSource: number;
let idEnfantSource: number;
let idArticleSource: number;
let idAllergeneSource: number;

before(async () => {
  dossierTemp = await fs.mkdtemp(path.join(os.tmpdir(), "restaurer-test-"));
  process.env.RESTORE_TARGET_DATABASE_URL = urlServeur();

  // Jeu de données représentatif (scénario 3 de la checklist F08), y compris un cas hiérarchique
  // pour exercer le cycle SousCategorieRecette (scénario 16), une clé primaire COMPOSITE
  // (ArticleAllergene, @@id([articleId, allergeneId])) et une clé primaire qui n'est PAS "id"
  // (ValeurNutritionnelle, @id sur articleId) — section 11 de la demande de correction F08.
  baseSource = await nouvelleBaseMigree("f08_source");
  const prisma = new PrismaClient({ datasources: { db: { url: urlBase(baseSource) } } });
  try {
    const societe = await prisma.societe.create({ data: { nom: "Source Test Co" } });
    idSocieteSource = societe.id;
    const categorie = await prisma.categorie.create({ data: { nom: "Épicerie", societeId: societe.id } });
    const tva = await prisma.tVA.create({ data: { nom: "TVA 20%", taux: 20 } });
    const parent = await prisma.sousCategorieRecette.create({ data: { nom: "Viande", societeId: societe.id } });
    idParentSource = parent.id;
    const enfant = await prisma.sousCategorieRecette.create({
      data: { nom: "Boeuf", societeId: societe.id, parentId: parent.id },
    });
    idEnfantSource = enfant.id;
    const article = await prisma.article.create({
      data: { nom: "Boeuf haché", type: "MATIERE_PREMIERE", categorieId: categorie.id, tvaId: tva.id, societeId: societe.id, rendement: 100 },
    });
    idArticleSource = article.id;
    const allergene = await prisma.allergene.create({ data: { nom: "Gluten", code: "GLUTEN" } });
    idAllergeneSource = allergene.id;
    await prisma.articleAllergene.create({ data: { articleId: article.id, allergeneId: allergene.id } });
    await prisma.valeurNutritionnelle.create({
      data: { articleId: article.id, energie: 250, proteines: 26, lipides: 15 },
    });
  } finally {
    await prisma.$disconnect();
  }

  // Backup réel (scénario 4), produit par le vrai script de sauvegarde (spawnSync, même convention
  // que tests/unit/sauvegarderScript.test.ts — jamais un import direct, voir ce fichier pour le
  // raisonnement).
  const dossierStockage = path.join(dossierTemp, "stockage");
  const resultat = spawnSync(process.execPath, ["--import", "tsx", "prisma/sauvegarder.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: urlBase(baseSource), DOCUMENTS_STORAGE_PATH: dossierStockage },
    encoding: "utf8",
  });
  assert.equal(resultat.status, 0, `sauvegarder.ts a échoué : ${resultat.stderr}`);
  const nomFichier = /Sauvegarde écrite : (.+\.json)/.exec(resultat.stdout)?.[1];
  assert.ok(nomFichier, `nom de fichier de sauvegarde introuvable dans la sortie : ${resultat.stdout}`);
  fichierSauvegardeReelle = nomFichier!;
});

after(async () => {
  for (const nom of basesACreer) {
    await supprimerBaseTest(nom);
  }
  await fs.rm(dossierTemp, { recursive: true, force: true });
});

// ============================================================================================
// Scénarios 5-8, 16-18 : restauration réelle réussie, comptages, relations, parentId, dry-run.
// ============================================================================================

test("dry-run complet : restauration réussie dans une base éphémère, détruite ensuite", async () => {
  const rapport = await restaurer(fichierSauvegardeReelle, true);
  assert.equal(rapport.succes, true);
  assert.equal(rapport.dryRun, true);
  assert.equal(rapport.chargement.comptagesParModele.Societe.attendu, rapport.chargement.comptagesParModele.Societe.charge);
  assert.equal(rapport.violationsInvariants.length, 0);
});

test("restauration réelle réussie : comptages exacts et migration finale alignée sur le dépôt", async () => {
  const nomCible = `f08_cible_${randomUUID().replace(/-/g, "")}`;
  await creerBaseTest(nomCible);
  basesACreer.push(nomCible);
  const urlCibleAvant = urlBase(nomCible);
  const ancienneUrl = process.env.RESTORE_TARGET_DATABASE_URL;
  process.env.RESTORE_TARGET_DATABASE_URL = urlCibleAvant;
  try {
    const rapport = await restaurer(fichierSauvegardeReelle, false);
    assert.equal(rapport.succes, true);
    assert.equal(rapport.migrationFinaleCible, rapport.migrationFinaleDepot);
    for (const [modele, c] of Object.entries(rapport.chargement.comptagesParModele)) {
      assert.equal(c.charge, c.attendu, `comptage incorrect pour ${modele}`);
    }

    // Scénario 7 : comparaison de données représentatives, pas seulement des comptages.
    const prisma = new PrismaClient({ datasources: { db: { url: urlCibleAvant } } });
    try {
      const societe = await prisma.societe.findFirstOrThrow({ where: { id: idSocieteSource } });
      assert.equal(societe.nom, "Source Test Co");

      // Scénario 8 : relation FK préservée (Article -> Categorie de la même société).
      const article = await prisma.article.findFirstOrThrow({ where: { nom: "Boeuf haché" } });
      const categorie = await prisma.categorie.findFirstOrThrow({ where: { id: article.categorieId! } });
      assert.equal(categorie.societeId, article.societeId);

      // Scénario 16 : le cycle SousCategorieRecette.parentId est correctement restauré.
      const enfant = await prisma.sousCategorieRecette.findFirstOrThrow({ where: { id: idEnfantSource } });
      assert.equal(enfant.parentId, idParentSource);
      assert.equal(enfant.nom, "Boeuf");

      // Section 11 (correction F08) : clé primaire COMPOSITE (ArticleAllergene) correctement
      // restaurée via la clause ON CONFLICT à deux colonnes introspectée dynamiquement.
      const articleAllergene = await prisma.articleAllergene.findFirstOrThrow({
        where: { articleId: idArticleSource, allergeneId: idAllergeneSource },
      });
      assert.equal(articleAllergene.articleId, idArticleSource);
      assert.equal(articleAllergene.allergeneId, idAllergeneSource);

      // Clé primaire qui N'EST PAS "id" (ValeurNutritionnelle.articleId) correctement restaurée.
      const valeurNutritionnelle = await prisma.valeurNutritionnelle.findFirstOrThrow({
        where: { articleId: idArticleSource },
      });
      assert.equal(valeurNutritionnelle.energie, 250);
      assert.equal(valeurNutritionnelle.proteines, 26);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    process.env.RESTORE_TARGET_DATABASE_URL = ancienneUrl;
  }
});

// ============================================================================================
// Correctif post-audit indépendant : réalignement des séquences PostgreSQL après restauration.
// Avant correction, chargerDonnees() insère les lignes avec leurs IDs explicites du backup (via
// upsert, voir inserer() dans restaurer.ts), mais ne touche jamais aux séquences PostgreSQL qui
// génèrent les IDs automatiques (colonnes `Int @id @default(autoincrement())`, 34 modèles du
// schéma courant). Une séquence fraîchement migrée démarre à 1 et n'avance que si une migration
// insère elle-même une ligne sans ID explicite — c'est le cas réel de "Societe" : la migration F11
// (20261005170000_cloisonne_referentiels_categories) y insère conditionnellement "Mon entreprise"
// SI la table est encore vide à ce stade, ce qui est vrai pendant la phase 1 de restaurer.ts
// (schéma reconstruit AVANT le chargement des données du backup). Le MAX(id) réel après
// restauration n'est donc pas toujours celui du tout premier élément créé côté source — d'où la
// vérification ci-dessous par requête directe du MAX(id) réel de la cible juste après restauration
// (jamais une valeur supposée a priori), avant tout INSERT supplémentaire du test lui-même.
test("séquences PostgreSQL : un INSERT normal après restauration ne collisionne jamais avec un ID restauré (modèle racine et modèle dépendant FK)", async () => {
  const nomCible = `f08_seq_${randomUUID().replace(/-/g, "")}`;
  await creerBaseTest(nomCible);
  basesACreer.push(nomCible);
  const urlCible = urlBase(nomCible);
  const ancienneUrl = process.env.RESTORE_TARGET_DATABASE_URL;
  process.env.RESTORE_TARGET_DATABASE_URL = urlCible;
  try {
    const rapport = await restaurer(fichierSauvegardeReelle, false);
    assert.equal(rapport.succes, true, `restauration en échec : ${JSON.stringify(rapport)}`);

    const prisma = new PrismaClient({ datasources: { db: { url: urlCible } } });
    try {
      // C. Plusieurs tables auto-incrémentées distinctes, réalignées sans liste codée en dur — pris
      // IMMÉDIATEMENT après restauration, avant tout INSERT supplémentaire de ce test, pour que la
      // comparaison porte sur l'état exact produit par la restauration elle-même. Le MAX(id) réel
      // de chaque table est lu directement sur la cible (jamais supposé a priori — voir le
      // commentaire du test), ce qui couvre aussi correctement le cas Societe (modifiée par le
      // backfill conditionnel de la migration F11, voir plus haut).
      for (const table of ["Societe", "Article", "Categorie", "TVA", "Allergene"]) {
        const [{ max }] = await prisma.$queryRawUnsafe<{ max: number }[]>(`SELECT MAX("id") AS max FROM "${table}"`);
        const [{ last_value }] = await prisma.$queryRawUnsafe<{ last_value: bigint }[]>(
          `SELECT last_value FROM "${table}_id_seq"`
        );
        assert.equal(
          Number(last_value),
          max,
          `la séquence de ${table} devrait être exactement au MAX(id) réel restauré (${max}), trouvé ${last_value}`
        );
      }

      // A. Modèle racine (Societe) : le prochain INSERT automatique (sans ID explicite) doit
      // recevoir un ID strictement supérieur à tout ID déjà restauré, sans quoi il échoue avec une
      // violation de contrainte unique (Societe_pkey) — c'est exactement la preuve du bug avant
      // correction (voir le rapport F08).
      const [{ max: maxSocieteAvant }] = await prisma.$queryRawUnsafe<{ max: number }[]>(
        `SELECT MAX("id") AS max FROM "Societe"`
      );
      const nouvelleSociete = await prisma.societe.create({ data: { nom: "Nouvelle société post-restauration" } });
      assert.ok(
        nouvelleSociete.id > maxSocieteAvant,
        `le nouvel ID Societe (${nouvelleSociete.id}) doit être strictement supérieur au MAX(id) restauré (${maxSocieteAvant}) — la séquence n'a pas été réalignée`
      );

      // Modèle dépendant avec FK (Article -> Categorie/TVA/Societe) : même preuve, sur un modèle
      // dont l'insertion automatique dépend aussi de clés étrangères valides.
      const categorie = await prisma.categorie.findFirstOrThrow({ where: { nom: "Épicerie" } });
      const tva = await prisma.tVA.findFirstOrThrow({ where: { nom: "TVA 20%" } });
      const nouvelArticle = await prisma.article.create({
        data: {
          nom: "Nouvel article post-restauration",
          type: "MATIERE_PREMIERE",
          categorieId: categorie.id,
          tvaId: tva.id,
          societeId: nouvelleSociete.id,
          rendement: 100,
        },
      });
      assert.ok(
        nouvelArticle.id > idArticleSource,
        `le nouvel ID Article (${nouvelArticle.id}) doit être strictement supérieur à l'ID restauré (${idArticleSource}) — la séquence n'a pas été réalignée`
      );

      // B. Table vide dans le backup (Fournisseur : jamais créée dans le jeu de données de test, et
      // jamais pré-seedée par aucune migration — vérifié) : un INSERT normal doit fonctionner sans
      // incident particulier, en recevant l'id 1 comme sur une base neuve — aucune réparation
      // spéciale requise pour une table sans ligne restaurée.
      const fournisseur = await prisma.fournisseur.create({
        data: { nom: "Nouveau fournisseur", societeId: nouvelleSociete.id },
      });
      assert.equal(fournisseur.id, 1, "le premier Fournisseur jamais créé doit recevoir l'id 1, comme sur une base neuve");

      // D. Aucun effet sur une clé primaire COMPOSITE (ArticleAllergene) ou NON auto-incrémentée
      // (ValeurNutritionnelle.articleId) : la logique de réalignement ne doit ni planter ni
      // interférer sur ces deux modèles, qui n'ont simplement aucune séquence à réaligner.
      const nouvelAllergene = await prisma.allergene.create({ data: { nom: "Lactose", code: "LACTOSE" } });
      await prisma.articleAllergene.create({ data: { articleId: nouvelArticle.id, allergeneId: nouvelAllergene.id } });
      await prisma.valeurNutritionnelle.create({ data: { articleId: nouvelArticle.id, energie: 100 } });
      const articleAllergeneVerif = await prisma.articleAllergene.findFirstOrThrow({
        where: { articleId: nouvelArticle.id, allergeneId: nouvelAllergene.id },
      });
      assert.equal(articleAllergeneVerif.articleId, nouvelArticle.id);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    process.env.RESTORE_TARGET_DATABASE_URL = ancienneUrl;
  }
});

// ============================================================================================
// Scénario 10 : cible non vide → refus.
// ============================================================================================

test("refuse de restaurer sur une base non vide, sans toucher à son contenu", async () => {
  const nom = await nouvelleBaseMigree("f08_non_vide");
  const url = urlBase(nom);
  await assert.rejects(() => verifierCibleVierge(url), CibleNonVierge);

  const ancienneUrl = process.env.RESTORE_TARGET_DATABASE_URL;
  process.env.RESTORE_TARGET_DATABASE_URL = url;
  try {
    await assert.rejects(() => restaurer(fichierSauvegardeReelle, false), CibleNonVierge);
  } finally {
    process.env.RESTORE_TARGET_DATABASE_URL = ancienneUrl;
  }
});

// ============================================================================================
// Scénario 18 : le dry-run ne modifie jamais une cible réelle, même nommée par
// RESTORE_TARGET_DATABASE_URL (il crée toujours sa propre base éphémère séparée).
// ============================================================================================

test("le dry-run ne touche jamais à la base nommée par RESTORE_TARGET_DATABASE_URL", async () => {
  const nom = await nouvelleBaseMigree("f08_intact");
  const url = urlBase(nom);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const avant = await prisma.societe.count();

  const ancienneUrl = process.env.RESTORE_TARGET_DATABASE_URL;
  process.env.RESTORE_TARGET_DATABASE_URL = url;
  try {
    const rapport = await restaurer(fichierSauvegardeReelle, true);
    assert.equal(rapport.succes, true);
  } finally {
    process.env.RESTORE_TARGET_DATABASE_URL = ancienneUrl;
  }

  const apres = await prisma.societe.count();
  assert.equal(apres, avant, "la base nommée par RESTORE_TARGET_DATABASE_URL ne doit jamais être modifiée par un dry-run");
  await prisma.$disconnect();
});

// ============================================================================================
// Scénarios 11-15 : sauvegarde corrompue/incomplète → refus avant toute écriture.
// ============================================================================================

async function ecrireFichier(nom: string, contenu: string): Promise<string> {
  const chemin = path.join(dossierTemp, nom);
  await fs.writeFile(chemin, contenu, "utf8");
  return chemin;
}

test("JSON invalide/tronqué : refus immédiat", async () => {
  const chemin = await ecrireFichier("corrompu.json", '{"formatVersion": 1, "modeles": {');
  await assert.rejects(() => lireEtValiderSauvegarde(chemin), SauvegardeInvalideError);
});

test("formatVersion absent : refus avec message explicite (format historique non supporté)", async () => {
  const chemin = await ecrireFichier(
    "sans-version.json",
    JSON.stringify({ creeLe: "2026-01-01T00:00:00Z", modeles: {} })
  );
  await assert.rejects(() => lireEtValiderSauvegarde(chemin), (err: unknown) => {
    assert.ok(err instanceof SauvegardeInvalideError);
    assert.match((err as Error).message, /[Ff]ormat historique non supporté/);
    return true;
  });
});

test("formatVersion inconnu : refus", async () => {
  const chemin = await ecrireFichier(
    "version-inconnue.json",
    JSON.stringify({ formatVersion: 999, creeLe: "2026-01-01T00:00:00Z", derniereMigrationAppliquee: "x", modeles: {} })
  );
  await assert.rejects(() => lireEtValiderSauvegarde(chemin), SauvegardeInvalideError);
});

test("migration déclarée inexistante dans le dépôt : refus", async () => {
  const chemin = await ecrireFichier(
    "migration-inconnue.json",
    JSON.stringify({
      formatVersion: 1,
      creeLe: "2026-01-01T00:00:00Z",
      derniereMigrationAppliquee: "20990101000000_migration_qui_n_existe_pas",
      modeles: {},
    })
  );
  await assert.rejects(() => lireEtValiderSauvegarde(chemin), SauvegardeInvalideError);
});

test("modèle manquant (table existante au schéma déclaré mais absente du JSON) : refus avant chargement", async () => {
  // Enveloppe structurellement valide mais délibérément incomplète : on retire "Categorie" du
  // contenu réel d'une sauvegarde par ailleurs authentique.
  const texte = await fs.readFile(fichierSauvegardeReelle, "utf8");
  const enveloppe = JSON.parse(texte);
  delete enveloppe.modeles.Categorie;
  const chemin = await ecrireFichier("modele-manquant.json", JSON.stringify(enveloppe));

  await assert.rejects(() => restaurer(chemin, true), (err: unknown) => {
    assert.ok(err instanceof SauvegardeInvalideError);
    assert.match((err as Error).message, /Categorie/);
    return true;
  });
});

// ============================================================================================
// Scénario 19 : échec au milieu du chargement → aucune restauration partielle déclarée réussie.
// ============================================================================================

test("une violation FK pendant le chargement fait échouer toute la restauration (jamais de partiel)", async () => {
  const texte = await fs.readFile(fichierSauvegardeReelle, "utf8");
  const enveloppe = JSON.parse(texte);
  // Article référence une TVA qui n'existe pas dans la sauvegarde — violation FK garantie au
  // moment de l'insertion, avec contraintes actives (jamais désactivées, voir §7 de la conception).
  enveloppe.modeles.Article[0].tvaId = 999999999;
  const chemin = await ecrireFichier("fk-invalide.json", JSON.stringify(enveloppe));

  await assert.rejects(() => restaurer(chemin, true));
});

// ============================================================================================
// Scénario 20 : invariant multi-société violé → validation en échec (jamais une restauration
// silencieusement déclarée réussie malgré une incohérence société que les FK ne détectent pas).
// ============================================================================================

test("une incohérence inter-société (categorieId d'une autre société) fait échouer la validation d'intégrité", async () => {
  const texte = await fs.readFile(fichierSauvegardeReelle, "utf8");
  const enveloppe = JSON.parse(texte);

  // Deuxième société + sa propre catégorie, toutes deux valides individuellement — mais on fait
  // ensuite pointer l'article de la société source vers la catégorie de cette AUTRE société :
  // aucune contrainte FK PostgreSQL ne l'interdit (Article.categorieId référence juste un id de
  // Categorie qui existe réellement), seul un invariant applicatif explicite peut le détecter —
  // exactement le risque que ce contrôle (voir restaurer.ts, verifierInvariantsSociete) couvre.
  const autreSocieteId = Math.max(...enveloppe.modeles.Societe.map((s: { id: number }) => s.id)) + 1000;
  enveloppe.modeles.Societe.push({
    id: autreSocieteId,
    nom: "Autre société (incohérence testée)",
    siret: null,
    actif: true,
    coefficientMultiplicateur: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const autreCategorieId = Math.max(...enveloppe.modeles.Categorie.map((c: { id: number }) => c.id)) + 1000;
  enveloppe.modeles.Categorie.push({
    id: autreCategorieId,
    nom: "Catégorie de l'autre société",
    couleur: null,
    icone: null,
    actif: true,
    societeId: autreSocieteId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  enveloppe.modeles.Article[0].categorieId = autreCategorieId;

  const chemin = await ecrireFichier("invariant-societe-invalide.json", JSON.stringify(enveloppe));
  const rapport = await restaurer(chemin, true);

  assert.equal(rapport.succes, false, "la restauration ne doit jamais être déclarée réussie avec un invariant société violé");
  assert.ok(rapport.violationsInvariants.length > 0);
  assert.ok(rapport.violationsInvariants.some((v) => v.modele === "Article"));
});

// ============================================================================================
// resoudreUrlCible : jamais DATABASE_URL implicite.
// ============================================================================================

test("resoudreUrlCible échoue si RESTORE_TARGET_DATABASE_URL n'est pas définie, même si DATABASE_URL l'est", () => {
  const sauvegarde = process.env.RESTORE_TARGET_DATABASE_URL;
  delete process.env.RESTORE_TARGET_DATABASE_URL;
  try {
    assert.throws(() => resoudreUrlCible(false, "peu-importe"));
  } finally {
    process.env.RESTORE_TARGET_DATABASE_URL = sauvegarde;
  }
});

// ============================================================================================
// Section 14 de la conception F08 phase 3, RENFORCÉ suite à l'audit indépendant : "C'est
// essentiel pour valider l'idée centrale." Un backup correspondant à un état de migration
// ANTÉRIEUR doit, une fois restauré, avoir réellement rejoué les migrations manquantes — y
// compris une migration qui transforme des données (20260930090000_utilisateurs_roles : convertit
// l'ancien compte unique AccesApplication en un Utilisateur nominatif puis supprime la table ; et
// la migration F11 20261005170000_cloisonne_referentiels_categories : rattache rétroactivement
// Categorie à une société). Construit un vrai backup à un point de schéma antérieur
// (20260929210000, juste avant ces deux migrations), réutilise construireDossierMigrationsTronque
// — la même fonction que restaurer() lui-même utilise, jamais une reconstruction parallèle du
// dossier tronqué — pour migrer une base source jusqu'à ce point exact, y insère des données
// représentatives de l'état de schéma de l'époque (via SQL brut : le client Prisma généré
// correspond au schéma COURANT, donc ses méthodes typées exigeraient des colonnes qui n'existaient
// pas encore), puis sauvegarde l'intégralité des tables réellement présentes à cet instant
// (générique, jamais une liste de tables recopiée à la main) pour obtenir un fichier JSON
// strictement conforme au format attendu.
//
// PREUVE DE PROVENANCE (renforcement demandé après l'audit indépendant, voir
// docs/sauvegarde-restauration.md) : l'identifiant ET le hash de code d'AccesApplication dans ce
// backup sont des valeurs DISTINCTIVES, impossibles à confondre avec le seed par défaut
// (admin/1234, voir 20260913131904_acces_application/migration.sql) qui existe déjà dans la base
// cible après la phase 1 (migrate deploy jusqu'au point du backup). Si l'Utilisateur final après
// restauration porte ces valeurs précises, c'est la preuve que la ligne AccesApplication du
// BACKUP a réellement été rechargée dans le schéma historique avant que
// 20260930090000_utilisateurs_roles ne la transforme — pas seulement que la migration a tourné
// sur le seed qu'elle insère elle-même. C'est exactement le défaut qu'un audit indépendant a
// identifié : voir "preuve du bug" dans le rapport final F08 pour le même test exécuté contre
// l'implémentation précédente (chargement piloté par le DMMF courant), où il échouait.
const IDENTIFIANT_DISTINCTIF = "preuve_f08_8f3a1c92";
const CODE_HACHE_DISTINCTIF = "$2b$10$preuveF08DistinctifPasUnSeedParDefaut1234567890123456";

test("PREUVE DE PROVENANCE : backup historique avec AccesApplication personnalisé → Utilisateur final contient exactement les valeurs du backup (pas le seed par défaut)", async () => {
  const MIGRATION_HISTORIQUE = "20260929210000_productions_haccp_datee";

  const nom = `f08_historique_${randomUUID().replace(/-/g, "")}`;
  await creerBaseTest(nom);
  basesACreer.push(nom);
  const urlHistorique = urlBase(nom);

  // Migre la base source UNIQUEMENT jusqu'au point de schéma antérieur — en réutilisant
  // exactement la fonction que restaurer() emploie pour sa propre phase 1, jamais une
  // reconstruction parallèle du dossier de migrations tronqué.
  const dossierTronque = await construireDossierMigrationsTronque(MIGRATION_HISTORIQUE);
  try {
    const resultat = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: dossierTronque,
      env: { ...process.env, DATABASE_URL: urlHistorique },
      encoding: "utf8",
    });
    assert.equal(resultat.status, 0, `migrate deploy tronqué a échoué : ${resultat.stderr}`);
  } finally {
    await fs.rm(dossierTronque, { recursive: true, force: true });
  }

  // Données représentatives de l'état de schéma de l'époque, via SQL brut (voir le commentaire du
  // test : le client Prisma généré correspond au schéma courant, pas à celui de 20260929210000).
  const prismaHistorique = new PrismaClient({ datasources: { db: { url: urlHistorique } } });
  let idSocieteHistorique: number;
  let idCategorieHistorique: number;
  try {
    const [societe] = await prismaHistorique.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "Societe" ("nom", "updatedAt") VALUES ('Société historique test', CURRENT_TIMESTAMP) RETURNING id`
    );
    idSocieteHistorique = societe.id;
    // "Categorie" n'a pas encore de colonne societeId à ce point de schéma (ajoutée par F11,
    // rejouée plus tard) — c'est précisément ce que ce test vérifie : le backfill rétroactif.
    const [categorie] = await prismaHistorique.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "Categorie" ("nom", "actif", "createdAt", "updatedAt") ` +
        `VALUES ('Catégorie historique test', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`
    );
    idCategorieHistorique = categorie.id;
    // AccesApplication a déjà une ligne par défaut (admin/1234), insérée par la migration de
    // création de la table elle-même (20260913131904_acces_application) — on l'écrase ici avec
    // une valeur distinctive pour que la preuve de provenance soit sans ambiguïté : si
    // l'Utilisateur final porte cette valeur précise, elle vient forcément du JSON du backup,
    // jamais du seed par défaut déjà présent après la phase 1.
    await prismaHistorique.$executeRawUnsafe(
      `UPDATE "AccesApplication" SET "identifiant" = $1, "codeHache" = $2, "updatedAt" = CURRENT_TIMESTAMP`,
      IDENTIFIANT_DISTINCTIF,
      CODE_HACHE_DISTINCTIF
    );
  } finally {
    await prismaHistorique.$disconnect();
  }

  // Sauvegarde générique de TOUTES les tables réellement présentes à ce point de schéma — jamais
  // une liste de tables recopiée à la main (même principe que sauvegarder.ts et
  // ordreRestauration.ts, mais au niveau SQL puisque le client typé ne correspond pas à ce schéma).
  const prismaDump = new PrismaClient({ datasources: { db: { url: urlHistorique } } });
  let modeles: Record<string, unknown[]>;
  try {
    const tables = await prismaDump.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE '\\_prisma%'
    `;
    modeles = {};
    for (const { table_name } of tables) {
      modeles[table_name] = await prismaDump.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${table_name}"`);
    }
  } finally {
    await prismaDump.$disconnect();
  }

  // Vérifie que le backup capture bien la valeur distinctive avant même de restaurer quoi que ce
  // soit — sinon un échec plus loin ne prouverait rien sur le mécanisme de restauration lui-même.
  const ligneAccesApplication = (modeles.AccesApplication as { identifiant: string }[])[0];
  assert.equal(
    ligneAccesApplication.identifiant,
    IDENTIFIANT_DISTINCTIF,
    "le backup lui-même doit contenir la valeur distinctive avant restauration"
  );

  const enveloppe = {
    formatVersion: 1,
    creeLe: new Date().toISOString(),
    derniereMigrationAppliquee: MIGRATION_HISTORIQUE,
    modeles,
  };
  const cheminHistorique = await ecrireFichier("sauvegarde-historique.json", JSON.stringify(enveloppe));

  // Restauration réelle (pas un dry-run) vers une base cible neuve, pour pouvoir inspecter le
  // résultat après coup — un dry-run détruit sa base éphémère avant qu'on puisse la vérifier.
  const nomCible = `f08_historique_cible_${randomUUID().replace(/-/g, "")}`;
  await creerBaseTest(nomCible);
  basesACreer.push(nomCible);
  const urlCible = urlBase(nomCible);
  const ancienneUrl = process.env.RESTORE_TARGET_DATABASE_URL;
  process.env.RESTORE_TARGET_DATABASE_URL = urlCible;
  try {
    const rapport = await restaurer(cheminHistorique, false);
    assert.equal(rapport.succes, true, `restauration historique en échec : ${JSON.stringify(rapport)}`);
    assert.equal(rapport.migrationBackup, MIGRATION_HISTORIQUE);
    assert.equal(
      rapport.migrationFinaleCible,
      rapport.migrationFinaleDepot,
      "le rattrapage doit amener la cible jusqu'à la dernière migration réelle du dépôt"
    );

    const prismaVerif = new PrismaClient({ datasources: { db: { url: urlCible } } });
    try {
      // PREUVE DE PROVENANCE : l'Utilisateur final doit porter EXACTEMENT les valeurs
      // distinctives du backup, jamais le seed par défaut (admin/...) déjà présent dans la base
      // cible après la phase 1 — c'est la preuve que la ligne AccesApplication du JSON a
      // réellement été rechargée dans le schéma historique avant le rejeu de
      // 20260930090000_utilisateurs_roles, pas seulement que cette migration a tourné sur son
      // propre seed.
      const utilisateur = await prismaVerif.utilisateur.findFirstOrThrow({
        where: { societeId: idSocieteHistorique },
      });
      assert.equal(utilisateur.role, "PROPRIETAIRE");
      assert.equal(utilisateur.societeId, idSocieteHistorique);
      assert.equal(
        utilisateur.identifiant,
        IDENTIFIANT_DISTINCTIF,
        "l'identifiant de l'Utilisateur final doit être celui du backup, pas le seed par défaut"
      );
      assert.equal(
        utilisateur.codeHache,
        CODE_HACHE_DISTINCTIF,
        "le codeHache de l'Utilisateur final doit être celui du backup, pas le seed par défaut"
      );

      // AccesApplication n'existe plus dans le schéma courant (DROP TABLE par cette même migration).
      const tablesRestantes = await prismaVerif.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'AccesApplication'
      `;
      assert.equal(tablesRestantes.length, 0, "AccesApplication doit avoir été supprimée par le rattrapage");

      // Backfill F11 (20261005170000_cloisonne_referentiels_categories) exécuté PENDANT le
      // rattrapage sur la Categorie chargée depuis le backup (qui n'avait pas encore societeId à
      // l'origine) : preuve que la migration de backfill agit correctement sur des données
      // restaurées d'une ancienne sauvegarde, pas seulement sur des données créées après coup.
      const categorie = await prismaVerif.categorie.findFirstOrThrow({ where: { id: idCategorieHistorique } });
      assert.equal(categorie.societeId, idSocieteHistorique);
      assert.equal(categorie.nom, "Catégorie historique test");

      // E. Séquences PostgreSQL correctement réalignées après un scénario historique complet
      // (rejeu de migrations + backfill F11), pas seulement après une restauration sur le schéma
      // courant : un INSERT automatique sur Utilisateur (créé par la migration utilisateurs_roles
      // pendant le rattrapage, donc avec un ID jamais explicitement présent dans le backup lui-même)
      // et sur Societe (chargée depuis le backup) doit recevoir un ID jamais déjà utilisé.
      const [{ max: maxUtilisateurAvant }] = await prismaVerif.$queryRawUnsafe<{ max: number }[]>(
        `SELECT MAX("id") AS max FROM "Utilisateur"`
      );
      const nouvelUtilisateur = await prismaVerif.utilisateur.create({
        data: {
          identifiant: "nouvel_utilisateur_post_historique",
          codeHache: "hash",
          role: "CHEF",
          societeId: idSocieteHistorique,
        },
      });
      assert.ok(
        nouvelUtilisateur.id > maxUtilisateurAvant,
        `le nouvel ID Utilisateur (${nouvelUtilisateur.id}) doit être strictement supérieur au MAX(id) déjà présent (${maxUtilisateurAvant})`
      );

      const [{ max: maxSocieteAvant }] = await prismaVerif.$queryRawUnsafe<{ max: number }[]>(
        `SELECT MAX("id") AS max FROM "Societe"`
      );
      const nouvelleSocieteHistorique = await prismaVerif.societe.create({
        data: { nom: "Nouvelle société post-restauration historique" },
      });
      assert.ok(
        nouvelleSocieteHistorique.id > maxSocieteAvant,
        `le nouvel ID Societe (${nouvelleSocieteHistorique.id}) doit être strictement supérieur au MAX(id) déjà présent (${maxSocieteAvant})`
      );
    } finally {
      await prismaVerif.$disconnect();
    }
  } finally {
    process.env.RESTORE_TARGET_DATABASE_URL = ancienneUrl;
  }
});
