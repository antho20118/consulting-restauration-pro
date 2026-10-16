import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import app from "../../server/app.js";
import prisma from "../../server/prisma.js";
import { hacherCode } from "../../server/utils/auth.js";
import { normaliserTexte } from "../../server/utils/normaliserTexte.js";

// Point 10 de l'audit du 15/10 (plusieurs entreprises clientes) : les correspondances apprises à
// l'import — texte d'ingrédient -> article (AliasIngredientImport) et produit vendu -> recette
// (AliasProduitVenduImport) — avaient une clé texte UNIQUE pour toute la plateforme. La deuxième
// entreprise qui mémorisait le même texte (« farine », « burger maison ») écrasait silencieusement
// la correspondance de la première, qui la perdait.

let server: Server;
let baseUrl: string;
const marqueur = `ALIAS-SOCIETE-${randomUUID()}`;
type Entreprise = { societeId: number; jeton: string; articleId: number; recetteId: number; fournisseurId: number };
const entreprises: Entreprise[] = [];
const TEXTE_INGREDIENT = `Farine T55 ${marqueur}`;
const PRODUIT_VENDU = `Burger maison ${marqueur}`;
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let dossierTemporaire: string;

function appel(jeton: string, method: string, chemin: string, body?: unknown) {
  return fetch(`${baseUrl}/api${chemin}`, {
    method,
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  // Photo d'un listing fournisseur stockée hors du dossier de l'application (voir listingsFournisseur.test.ts).
  dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), "alias-societe-test-"));
  process.env.DOCUMENTS_STORAGE_PATH = dossierTemporaire;
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("Adresse du serveur de test invalide");
  baseUrl = `http://127.0.0.1:${adresse.port}`;

  const tvaId = (await prisma.tVA.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
  for (const lettre of ["A", "B"]) {
    const societeId = (await prisma.societe.create({ data: { nom: `${marqueur} ${lettre}` } })).id;
    const identifiant = `${marqueur}-${lettre}`;
    await prisma.utilisateur.create({ data: { identifiant, codeHache: hacherCode("1234"), role: "PROPRIETAIRE", societeId } });
    const connexion = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiant, code: "1234" }),
    });
    const jeton = ((await connexion.json()) as { token: string }).token;
    const categorieId = (await prisma.categorie.create({ data: { nom: `${marqueur} ${lettre}`, societeId } })).id;
    const articleId = (
      await prisma.article.create({ data: { nom: `Farine ${lettre}`, type: "MATIERE_PREMIERE", categorieId, tvaId, societeId } })
    ).id;
    // Même nom de recette dans les deux entreprises : chacune valide le produit vendu vers la sienne.
    const recetteId = (await prisma.recette.create({ data: { nom: PRODUIT_VENDU, societeId, portions: 1 } })).id;
    const fournisseurId = (await prisma.fournisseur.create({ data: { nom: `${marqueur} ${lettre}`, societeId, codeFournisseur: "FOU-TEST" } })).id;
    entreprises.push({ societeId, jeton, articleId, recetteId, fournisseurId });
  }
});

after(async () => {
  try {
    const societeIds = entreprises.map((e) => e.societeId);
    await prisma.aliasIngredientImport.deleteMany({ where: { article: { societeId: { in: societeIds } } } });
    await prisma.aliasProduitVenduImport.deleteMany({ where: { recette: { societeId: { in: societeIds } } } });
    const fournisseurIds = entreprises.map((e) => e.fournisseurId);
    await prisma.ligneDocumentFournisseur.deleteMany({ where: { document: { fournisseurId: { in: fournisseurIds } } } });
    await prisma.documentFournisseur.deleteMany({ where: { fournisseurId: { in: fournisseurIds } } });
    await prisma.produitFournisseur.deleteMany({ where: { fournisseurId: { in: fournisseurIds } } });
    await prisma.fournisseur.deleteMany({ where: { id: { in: fournisseurIds } } });
    // Lignes de vente supprimées en cascade avec leur document (LigneVente.documentVentes).
    await prisma.documentVentes.deleteMany({ where: { societeId: { in: societeIds } } });
    await prisma.recette.deleteMany({ where: { societeId: { in: societeIds } } });
    await prisma.article.deleteMany({ where: { societeId: { in: societeIds } } });
    await prisma.categorie.deleteMany({ where: { societeId: { in: societeIds } } });
    await prisma.utilisateur.deleteMany({ where: { societeId: { in: societeIds } } });
    await prisma.societe.deleteMany({ where: { id: { in: societeIds } } });
  } finally {
    delete process.env.DOCUMENTS_STORAGE_PATH;
    await fs.rm(dossierTemporaire, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

test("ingrédients : la même formulation mémorisée par deux entreprises garde la correspondance de chacune", async () => {
  for (const e of entreprises) {
    const reponse = await appel(e.jeton, "POST", "/alias-ingredients", {
      correspondances: [{ texte: TEXTE_INGREDIENT, articleId: e.articleId }],
    });
    assert.equal(reponse.status, 204);
  }
  for (const e of entreprises) {
    const alias = (await (await appel(e.jeton, "GET", "/alias-ingredients")).json()) as { texteNormalise: string; articleId: number }[];
    const trouve = alias.find((a) => a.texteNormalise === normaliserTexte(TEXTE_INGREDIENT));
    assert.equal(trouve?.articleId, e.articleId, `entreprise ${e.societeId}`);
  }
});

test("ventes : le même produit vendu validé par deux entreprises garde la correspondance de chacune", async () => {
  for (const e of entreprises) {
    const reponse = await appel(e.jeton, "POST", "/ventes/import", {
      nomFichierOriginal: "caisse.csv",
      lignes: [{ designation: PRODUIT_VENDU, quantite: "1", decision: "VALIDEE", recetteRetenueId: e.recetteId }],
    });
    assert.equal(reponse.status, 201, await reponse.text());
  }
  for (const e of entreprises) {
    const alias = await prisma.aliasProduitVenduImport.findFirst({
      where: { texteNormalise: normaliserTexte(PRODUIT_VENDU), recette: { societeId: e.societeId } },
    });
    assert.equal(alias?.recetteId, e.recetteId, `entreprise ${e.societeId}`);
  }
});

test("ventes : à l'import, chaque entreprise retrouve SA correspondance pour un même texte de caisse", async () => {
  const texteCaisse = `PLAT JOUR ${marqueur}`;
  for (const e of entreprises) {
    await prisma.aliasProduitVenduImport.create({
      data: { societeId: e.societeId, texteNormalise: normaliserTexte(texteCaisse), recetteId: e.recetteId },
    });
  }
  for (const e of entreprises) {
    const reponse = await appel(e.jeton, "POST", "/ventes/import/apercu", { lignes: [{ designation: texteCaisse, quantite: "1" }] });
    const { lignes } = (await reponse.json()) as { lignes: { recetteProposeeId: number; motifCorrespondance: string }[] };
    assert.equal(lignes[0].motifCorrespondance, "ALIAS", `entreprise ${e.societeId}`);
    assert.equal(lignes[0].recetteProposeeId, e.recetteId, `entreprise ${e.societeId}`);
  }
});

test("listing fournisseur : chaque entreprise retrouve SA correspondance d'ingrédient pour une même désignation", async () => {
  const designation = `PERSIL MAISON ${marqueur}`;
  for (const e of entreprises) {
    await prisma.aliasIngredientImport.create({
      data: { societeId: e.societeId, texteNormalise: normaliserTexte(designation), articleId: e.articleId },
    });
  }
  for (const e of entreprises) {
    const reponse = await appel(e.jeton, "POST", `/listings-fournisseur/${e.fournisseurId}`, {
      nomFichierOriginal: "listing.png",
      photoDataUrl: PNG_1X1,
      lignes: [{ designation, prix: "2,50" }],
    });
    assert.equal(reponse.status, 201, await reponse.clone().text());
    const { lignes } = (await reponse.json()) as { lignes: { articleProposeId: number; motifCorrespondance: string }[] };
    assert.equal(lignes[0].motifCorrespondance, "ALIAS", `entreprise ${e.societeId}`);
    assert.equal(lignes[0].articleProposeId, e.articleId, `entreprise ${e.societeId}`);
  }
});
