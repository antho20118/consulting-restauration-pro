import { test } from "node:test";
import assert from "node:assert/strict";
import {
  construireLigneImportee,
  construireMaterielImporte,
  trouverArticle,
  trouverUnite,
} from "../../src/features/recettes/utils/ligneImportee.js";
import type {
  ArticleRecette,
  IngredientExtrait,
  MaterielExtrait,
  TypeArticle,
  UniteRecette,
} from "../../src/features/recettes/types/recette.js";

// Teste src/features/recettes/utils/ligneImportee.ts, le cœur du pipeline d'import IA/OCR côté
// client (voir l'audit fonctionnel « import IA » et PR #61) : le rapprochement automatique
// d'article/unité ne doit jamais avoir l'air d'un choix humain déjà confirmé, et une unité non
// reconnue ne doit plus jamais retomber silencieusement sur le kg.

function article(id: number, nom: string, type: TypeArticle = "MATIERE_PREMIERE"): ArticleRecette {
  return { id, nom, reference: null, rendement: 100, type, tarifs: [], allergenes: [] };
}

function materiel(partiel: Partial<MaterielExtrait>): MaterielExtrait {
  return { texteOriginal: "", nomExtrait: "", confiance: "faible", ...partiel };
}

function unite(id: number, symbole: string): UniteRecette {
  return { id, nom: symbole, symbole, facteurBase: 1 };
}

function ingredient(partiel: Partial<IngredientExtrait>): IngredientExtrait {
  return {
    texteOriginal: "",
    nomExtrait: "",
    quantite: null,
    unite: null,
    precision: null,
    confiance: "faible",
    ...partiel,
  };
}

const ARTICLES = [article(1, "Farine de blé T55"), article(2, "Farine de sarrasin"), article(3, "Beurre doux")];
const UNITES = [unite(10, "kg"), unite(11, "L"), unite(12, "pièce")];

test("trouverArticle : correspondance exacte (insensible à la casse/accents)", () => {
  const trouve = trouverArticle("beurre doux", ARTICLES, new Map());
  assert.equal(trouve?.id, 3);
});

test("trouverArticle : correspondance approximative privilégie le nom le plus proche en longueur (« Farine » ne doit pas matcher « Farine de sarrasin »)", () => {
  const trouve = trouverArticle("farine de blé", ARTICLES, new Map());
  assert.equal(trouve?.id, 1);
});

test("trouverArticle : aucune correspondance → null (jamais un article au hasard)", () => {
  assert.equal(trouverArticle("levure chimique", ARTICLES, new Map()), null);
});

test("trouverArticle : un alias mémorisé prime sur la recherche approximative", () => {
  // La clé de la map est déjà normalisée (accents/casse), comme AliasIngredient.texteNormalise
  // côté serveur — voir normaliserTexte.ts.
  const alias = new Map([["farine de ble", 2]]); // corrige volontairement vers l'article 2
  const trouve = trouverArticle("Farine de blé", ARTICLES, alias);
  assert.equal(trouve?.id, 2);
});

test("trouverUnite : correspondance exacte de symbole uniquement (pas d'approximation)", () => {
  assert.equal(trouverUnite("kg", UNITES)?.id, 10);
  assert.equal(trouverUnite("Kg", UNITES)?.id, 10); // insensible à la casse, comme trouverArticle
  assert.equal(trouverUnite("kilogramme", UNITES), null); // pas de correspondance partielle
  assert.equal(trouverUnite(null, UNITES), null);
});

test("construireLigneImportee : article et unité reconnus (même par correspondance exacte) → toujours à confirmer, aucune valeur inventée", () => {
  // Volontairement pas de distinction exact/approximatif ici : même une correspondance exacte
  // reste une décision automatique tant que l'utilisateur ne l'a pas vue et validée dans le
  // formulaire — voir la note de design dans ligneImportee.ts.
  const ligne = construireLigneImportee(
    ingredient({ nomExtrait: "beurre doux", quantite: 250, unite: "kg" }),
    ARTICLES,
    UNITES,
    new Map()
  );
  assert.deepEqual(ligne, {
    articleId: 3,
    articleConfirme: false,
    quantite: 250,
    uniteId: 10,
    gainCuissonPct: 0,
    texteIngredientImporte: "beurre doux",
  });
});

test("construireLigneImportee : article introuvable → articleId=0, articleConfirme=true (rien d'automatique à signaler, le champ est visiblement vide)", () => {
  const ligne = construireLigneImportee(
    ingredient({ nomExtrait: "levure chimique", quantite: 5, unite: "kg" }),
    ARTICLES,
    UNITES,
    new Map()
  );
  assert.equal(ligne.articleId, 0);
  assert.equal(ligne.articleConfirme, true);
});

test("construireLigneImportee : article rapproché par correspondance approximative → articleConfirme=false (à confirmer)", () => {
  // « Beurre » ne correspond exactement à aucun article, mais correspond à « Beurre doux » par
  // inclusion : c'est précisément le cas où un mauvais rapprochement pourrait passer inaperçu.
  const ligne = construireLigneImportee(
    ingredient({ nomExtrait: "Beurre", quantite: 100, unite: "kg" }),
    ARTICLES,
    UNITES,
    new Map()
  );
  assert.equal(ligne.articleId, 3);
  assert.equal(ligne.articleConfirme, false);
});

test("construireLigneImportee : article retrouvé via un alias mémorisé → articleConfirme=false (toujours une décision automatique, même si déjà validée une fois par le passé)", () => {
  const alias = new Map([["beurre", 3]]);
  const ligne = construireLigneImportee(
    ingredient({ nomExtrait: "Beurre", quantite: 100, unite: "kg" }),
    ARTICLES,
    UNITES,
    alias
  );
  assert.equal(ligne.articleId, 3);
  assert.equal(ligne.articleConfirme, false);
});

test("construireLigneImportee : unité non reconnue → uniteId=0, JAMAIS de repli sur le kg", () => {
  const ligne = construireLigneImportee(
    ingredient({ nomExtrait: "beurre doux", quantite: 2, unite: "cuillère à café" }),
    ARTICLES,
    UNITES,
    new Map()
  );
  assert.equal(ligne.uniteId, 0);
});

test("construireLigneImportee : unité absente (null, IA incertaine) → uniteId=0", () => {
  const ligne = construireLigneImportee(
    ingredient({ nomExtrait: "beurre doux", quantite: 2, unite: null }),
    ARTICLES,
    UNITES,
    new Map()
  );
  assert.equal(ligne.uniteId, 0);
});

test("construireLigneImportee : quantité et unité reconnues correctement pour kg/L/pièce", () => {
  assert.equal(construireLigneImportee(ingredient({ nomExtrait: "beurre doux", quantite: 25, unite: "kg" }), ARTICLES, UNITES, new Map()).uniteId, 10);
  assert.equal(construireLigneImportee(ingredient({ nomExtrait: "beurre doux", quantite: 5, unite: "L" }), ARTICLES, UNITES, new Map()).uniteId, 11);
  assert.equal(construireLigneImportee(ingredient({ nomExtrait: "beurre doux", quantite: 30, unite: "pièce" }), ARTICLES, UNITES, new Map()).uniteId, 12);
});

test("construireLigneImportee : quantité absente (IA imprécise, ex. « une pincée ») → quantite=0", () => {
  const ligne = construireLigneImportee(
    ingredient({ nomExtrait: "beurre doux", quantite: null, unite: "kg" }),
    ARTICLES,
    UNITES,
    new Map()
  );
  assert.equal(ligne.quantite, 0);
});

const ARTICLES_AVEC_MATERIEL = [
  ...ARTICLES,
  article(4, "Thermomètre sonde", "PETIT_MATERIEL"),
  article(5, "Poche à douille", "PETIT_MATERIEL"),
];

test("construireMaterielImporte : matériel reconnu parmi les seuls articles PETIT_MATERIEL → à confirmer", () => {
  const resultat = construireMaterielImporte(
    materiel({ nomExtrait: "thermomètre sonde", confiance: "elevee" }),
    ARTICLES_AVEC_MATERIEL,
    new Map()
  );
  assert.equal(resultat.articleId, 4);
  assert.equal(resultat.articleConfirme, false);
  assert.equal(resultat.confiance, "elevee");
});

test("construireMaterielImporte : jamais de rapprochement avec un article alimentaire même si le nom correspond mieux", () => {
  // « Beurre doux » (article alimentaire, id 3) ne doit jamais être proposé comme matériel, même
  // si son nom se rapprocherait d'un texte mal extrait — le filtre PETIT_MATERIEL prime toujours.
  const resultat = construireMaterielImporte(
    materiel({ nomExtrait: "beurre doux" }),
    ARTICLES_AVEC_MATERIEL,
    new Map()
  );
  assert.equal(resultat.articleId, 0);
  assert.equal(resultat.articleConfirme, true);
});

test("construireMaterielImporte : matériel inconnu → articleId=0, à résoudre par l'utilisateur", () => {
  const resultat = construireMaterielImporte(
    materiel({ nomExtrait: "chalumeau de cuisine" }),
    ARTICLES_AVEC_MATERIEL,
    new Map()
  );
  assert.equal(resultat.articleId, 0);
  assert.equal(resultat.articleConfirme, true);
});
