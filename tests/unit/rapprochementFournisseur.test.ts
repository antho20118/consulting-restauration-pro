import { test } from "node:test";
import assert from "node:assert/strict";

import {
  rapprocherLigne,
  detecterNatureLigne,
  type ContexteRapprochement,
  type CandidatRapprochement,
} from "../../server/utils/rapprochementFournisseur.js";

// Test unitaire pur (aucune base, aucun serveur) du nouveau moteur de rapprochement Phase 3 — voir
// server/utils/rapprochementFournisseur.ts. N'exerce jamais server/utils/importListing.ts au-delà
// de ses exports réutilisés tels quels (similariteJaccard, SEUIL_CORRESPONDANCE_DESIGNATION) :
// aucune régression possible sur ce fichier puisqu'il n'est pas modifié par cette phase.

function candidat(partiel: Partial<CandidatRapprochement> & { articleId: number; nom: string }): CandidatRapprochement {
  return { reference: null, uniteActiveType: null, ...partiel };
}

function contexte(
  candidats: CandidatRapprochement[],
  alias: [string, number][] = [],
  produitsFournisseur: [string, { articleId: number; designationConnue: string }][] = []
): ContexteRapprochement {
  return {
    candidats,
    aliasParTexteNormalise: new Map(alias),
    produitsFournisseurConnus: new Map(produitsFournisseur),
  };
}

// --- Priorité 0 : code produit fournisseur déjà connu (ProduitFournisseur, scopé au fournisseur) ---

test("certaine : code produit fournisseur déjà connu, désignation cohérente avec celle mémorisée", () => {
  const ctx = contexte(
    [candidat({ articleId: 1, nom: "Filet de poulet" })],
    [],
    [["ABC123", { articleId: 1, designationConnue: "Filet de poulet fermier" }]]
  );
  const resultat = rapprocherLigne("FILET POULET FERMIER", "ABC123", null, ctx);
  assert.deepEqual(resultat, { cas: "certaine", articleId: 1, motif: "CODE_ARTICLE" });
});

test("priorité 0 : le code produit fournisseur connu gagne même sur une référence catalogue (Article.reference) différente", () => {
  const ctx = contexte(
    [candidat({ articleId: 1, nom: "Filet de poulet" }), candidat({ articleId: 2, nom: "Filet de dinde", reference: "ABC123" })],
    [],
    [["ABC123", { articleId: 1, designationConnue: "Filet de poulet fermier" }]]
  );
  const resultat = rapprocherLigne("Filet de poulet fermier", "ABC123", null, ctx);
  assert.deepEqual(resultat, { cas: "certaine", articleId: 1, motif: "CODE_ARTICLE" });
});

test("code produit fournisseur normalisé avant comparaison (espace insécable/casse conservée, voir normaliserCodeProduitFournisseur)", () => {
  const ctx = contexte(
    [candidat({ articleId: 1, nom: "Filet de poulet" })],
    [],
    [["ABC123", { articleId: 1, designationConnue: "Filet de poulet fermier" }]]
  );
  const resultat = rapprocherLigne("Filet de poulet fermier", "ABC123 ", null, ctx);
  assert.deepEqual(resultat, { cas: "certaine", articleId: 1, motif: "CODE_ARTICLE" });
});

test("approximative_unique : code connu mais désignation très différente de celle mémorisée — jamais un rattachement automatique silencieux", () => {
  const ctx = contexte(
    [candidat({ articleId: 1, nom: "Filet de poulet" })],
    [],
    [["ABC123", { articleId: 1, designationConnue: "Filet de poulet fermier" }]]
  );
  const resultat = rapprocherLigne("Semoule fine grand sac", "ABC123", null, ctx);
  assert.equal(resultat.cas, "approximative_unique");
  assert.equal((resultat as { articleId: number }).articleId, 1);
});

test("un code absent du contexte retombe sur le rapprochement catalogue existant (Article.reference)", () => {
  const ctx = contexte(
    [candidat({ articleId: 1, nom: "Filet de poulet", reference: "REF-123" })],
    [],
    [["AUTRE-CODE", { articleId: 2, designationConnue: "Autre article" }]]
  );
  const resultat = rapprocherLigne("POULET FILET", "REF-123", null, ctx);
  assert.deepEqual(resultat, { cas: "certaine", articleId: 1, motif: "REFERENCE_FOURNISSEUR" });
});

// --- Correspondances certaines ---

test("certaine : référence fournisseur exacte", () => {
  const ctx = contexte([
    candidat({ articleId: 1, nom: "Filet de poulet", reference: "REF-123" }),
    candidat({ articleId: 2, nom: "Filet de poulet fermier", reference: "REF-999" }),
  ]);
  const resultat = rapprocherLigne("POULET FILET", "REF-123", null, ctx);
  assert.deepEqual(resultat, { cas: "certaine", articleId: 1, motif: "REFERENCE_FOURNISSEUR" });
});

test("certaine : désignation normalisée exacte (accents/casse ignorés)", () => {
  const ctx = contexte([candidat({ articleId: 5, nom: "Crème fraîche épaisse" })]);
  const resultat = rapprocherLigne("CREME FRAICHE EPAISSE", null, null, ctx);
  assert.deepEqual(resultat, { cas: "certaine", articleId: 5, motif: "DESIGNATION_EXACTE" });
});

test("certaine : alias connu (AliasIngredientImport, lecture seule)", () => {
  // La clé de la Map est déjà normalisée (voir server/routes/aliasIngredients.ts : la table stocke
  // texteNormalise, jamais le texte brut) — jamais un accent ici, comme en base réelle.
  const ctx = contexte(
    [candidat({ articleId: 8, nom: "Persil plat botte" })],
    [["persil frise", 8]]
  );
  const resultat = rapprocherLigne("PERSIL FRISE", null, null, ctx);
  assert.deepEqual(resultat, { cas: "certaine", articleId: 8, motif: "ALIAS" });
});

test("le moteur ne modifie jamais la Map d'alias reçue (lecture seule, pas un second système d'alias)", () => {
  const aliasMap = new Map<string, number>([["persil frise", 8]]);
  const ctx: ContexteRapprochement = {
    candidats: [candidat({ articleId: 8, nom: "Persil plat botte" })],
    aliasParTexteNormalise: aliasMap,
    produitsFournisseurConnus: new Map(),
  };
  rapprocherLigne("PERSIL FRISE", null, null, ctx);
  assert.equal(aliasMap.size, 1);
  assert.equal(aliasMap.get("persil frise"), 8);
});

// --- Correspondances approximatives ---

test("approximative_unique : un seul candidat au-dessus du seuil", () => {
  const ctx = contexte([
    candidat({ articleId: 1, nom: "Escalope de veau" }),
    candidat({ articleId: 2, nom: "Filet de saumon" }),
  ]);
  const resultat = rapprocherLigne("Escalope veau", null, null, ctx);
  assert.equal(resultat.cas, "approximative_unique");
  assert.equal((resultat as { articleId: number }).articleId, 1);
});

test("plusieurs_candidats : deux candidats proches au-dessus du seuil, aucune sélection automatique", () => {
  // Scores vérifiés indépendamment (0.667 chacun, ≥ seuil 0.6) : "filet"/"de" sont des mots vides
  // du moteur de similarité existant (voir MOTS_VIDES, importListing.ts), la seule différence
  // discriminante entre les deux candidats est donc leur dernier mot ("fermier" vs "bio").
  const ctx = contexte([
    candidat({ articleId: 1, nom: "Filet de poulet mariné fermier" }),
    candidat({ articleId: 2, nom: "Filet de poulet mariné bio" }),
  ]);
  const resultat = rapprocherLigne("Filet de poulet mariné", null, null, ctx);
  assert.equal(resultat.cas, "plusieurs_candidats");
  const candidats = (resultat as { candidats: { articleId: number }[] }).candidats;
  assert.equal(candidats.length, 2);
  assert.deepEqual(
    candidats.map((c) => c.articleId).sort(),
    [1, 2]
  );
});

test("aucun_candidat : rien au-dessus du seuil, jamais d'article inventé", () => {
  const ctx = contexte([candidat({ articleId: 1, nom: "Tarte aux pommes" })]);
  const resultat = rapprocherLigne("Semoule fine grand sac", null, null, ctx);
  assert.deepEqual(resultat, { cas: "aucun_candidat" });
});

// --- Priorité stricte (un niveau supérieur n'est jamais remplacé par un niveau inférieur) ---

test("priorité : référence exacte gagne même si la désignation ressemble davantage à un autre candidat", () => {
  const ctx = contexte([
    candidat({ articleId: 1, nom: "Filet de poulet", reference: "REF-A" }),
    candidat({ articleId: 2, nom: "Filet de poulet fermier bio label rouge" }),
  ]);
  const resultat = rapprocherLigne("Filet de poulet fermier", "REF-A", null, ctx);
  assert.deepEqual(resultat, { cas: "certaine", articleId: 1, motif: "REFERENCE_FOURNISSEUR" });
});

test("priorité : alias gagne sur la similarité même si un autre candidat a un score plus élevé", () => {
  const ctx = contexte(
    [
      candidat({ articleId: 1, nom: "Persil plat" }),
      candidat({ articleId: 2, nom: "Persil frise botte fraiche du jour" }),
    ],
    [["persil frise", 1]]
  );
  const resultat = rapprocherLigne("Persil frise", null, null, ctx);
  assert.deepEqual(resultat, { cas: "certaine", articleId: 1, motif: "ALIAS" });
});

test("priorité : désignation exacte gagne sur la similarité", () => {
  const ctx = contexte([
    candidat({ articleId: 1, nom: "Farine T55" }),
    candidat({ articleId: 2, nom: "Farine T55 grand sac 25kg" }),
  ]);
  const resultat = rapprocherLigne("Farine T55", null, null, ctx);
  assert.deepEqual(resultat, { cas: "certaine", articleId: 1, motif: "DESIGNATION_EXACTE" });
});

test("une référence de ligne différente de celle d'un candidat exclut ce candidat, même à désignation identique", () => {
  const ctx = contexte([candidat({ articleId: 1, nom: "Filet de poulet", reference: "REF-AUTRE" })]);
  const resultat = rapprocherLigne("Filet de poulet", "REF-CETTE-LIGNE", null, ctx);
  // Le seul candidat porte une référence différente : jamais retenu, ni en certaine ni en
  // approximatif (voir candidatsEligibles) — aucun candidat plutôt qu'une fausse certitude.
  assert.deepEqual(resultat, { cas: "aucun_candidat" });
});

// --- Conditionnement / unité ---

// Paire vérifiée indépendamment (score Jaccard = 0.667 ≥ seuil 0.6, chaînes non égales après
// normalisation simple donc jamais interceptées par le palier "désignation exacte") : isole
// proprement le filtre de cohérence d'unité, testé sur ce même couple dans les trois tests
// suivants en ne faisant varier que uniteActiveType/uniteDetecteeType.
const DESIGNATION_LIGNE = "Compote de pommes";
const NOM_CANDIDAT = "Compote pommes maison";

test("conditionnement cohérent (même famille d'unité) : candidat conservé en approximatif", () => {
  const ctx = contexte([candidat({ articleId: 1, nom: NOM_CANDIDAT, uniteActiveType: "poids" })]);
  const resultat = rapprocherLigne(DESIGNATION_LIGNE, null, "poids", ctx);
  assert.equal(resultat.cas, "approximative_unique");
});

test("conditionnement incohérent (unité différente) : candidat exclu même à désignation proche", () => {
  const ctx = contexte([candidat({ articleId: 1, nom: NOM_CANDIDAT, uniteActiveType: "piece" })]);
  const resultat = rapprocherLigne(DESIGNATION_LIGNE, null, "poids", ctx);
  assert.deepEqual(resultat, { cas: "aucun_candidat" });
});

test("familles d'unité inconnues (candidat sans tarif ou unité non détectée sur la ligne) : jamais bloquant", () => {
  const ctx = contexte([candidat({ articleId: 1, nom: NOM_CANDIDAT, uniteActiveType: null })]);
  const resultat = rapprocherLigne(DESIGNATION_LIGNE, null, "poids", ctx);
  assert.equal(resultat.cas, "approximative_unique");
});

// --- Nature des lignes ---

test("nature ARTICLE par défaut (aucun mot-clé reconnu)", () => {
  assert.equal(detecterNatureLigne("Escalope de veau 5kg"), "ARTICLE");
});

test("nature FRAIS_LIVRAISON", () => {
  assert.equal(detecterNatureLigne("Frais de livraison"), "FRAIS_LIVRAISON");
  assert.equal(detecterNatureLigne("Transport marchandises"), "FRAIS_LIVRAISON");
});

test("nature AVOIR", () => {
  assert.equal(detecterNatureLigne("Avoir sur facture précédente"), "AVOIR");
});

test("nature REMISE", () => {
  assert.equal(detecterNatureLigne("Remise fidélité 5%"), "REMISE");
  assert.equal(detecterNatureLigne("Ristourne trimestrielle"), "REMISE");
});

test("nature NON_ALIMENTAIRE (mot-clé reconnu)", () => {
  assert.equal(detecterNatureLigne("Produit d'entretien sol"), "NON_ALIMENTAIRE");
  assert.equal(detecterNatureLigne("Gants latex boite 100"), "NON_ALIMENTAIRE");
});

test("nature indéterminable de façon fiable : reste ARTICLE (jamais une classification non alimentaire devinée)", () => {
  // Aucun mot-clé de la liste, texte ambigu sans signal fiable — le résultat reste ARTICLE, l'état
  // qui exige une validation humaine dans le pipeline (decision reste EN_ATTENTE), conformément à
  // la règle « si la nature ne peut pas être déterminée de manière fiable... ».
  assert.equal(detecterNatureLigne("XZQ 4471 réf catalogue inconnue"), "ARTICLE");
});

// --- Sécurité : ce moteur ne peut structurellement rien écrire ---

test("ce module n'importe aucun client Prisma (aucune écriture possible)", async () => {
  const module = await import("../../server/utils/rapprochementFournisseur.js");
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../../server/utils/rapprochementFournisseur.ts", import.meta.url), "utf-8")
  );
  assert.doesNotMatch(source, /from ["']\.\.\/prisma\.js["']/);
  assert.doesNotMatch(source, /PrismaClient/);
  assert.equal(typeof module.rapprocherLigne, "function");
});
