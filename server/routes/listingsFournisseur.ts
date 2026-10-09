import { Router } from "express";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import prisma from "../prisma.js";
import {
  extraireLignesListingPhoto,
  ImportIANonConfigureError,
  PhotoInvalideError,
} from "../utils/importListingPhotoIA.js";
import { extraireFacturePhoto } from "../utils/importFacturePhotoIA.js";
import { enregistrerDocument, DocumentInvalideError } from "../utils/storageDocumentsFournisseur.js";
import {
  rapprocherLigne,
  detecterNatureLigne,
  type ContexteRapprochement,
  type CandidatRapprochement,
} from "../utils/rapprochementFournisseur.js";
import { extraireQuantiteDesignation, parsePrix, normaliserCodeProduitFournisseur } from "../utils/importListing.js";
import { resoudreOuCreerProduitFournisseur } from "../utils/produitFournisseur.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// PR E de l'audit F09/F10 : valide UNIQUEMENT la structure qui fait aujourd'hui crasher
// creerLignesDocument en 500 (élément non-objet/null, reference/conditionnement de type
// non-string) — jamais le métier de designation/prix, qui reste un JAUNE non arbitré (voir le
// rapport d'audit). `designation`/`prix` restent `z.unknown()` : un objet, un nombre, etc. pour
// designation, ou n'importe quoi pour prix, continuent de traverser ce schéma sans être rejetés,
// exactement comme avant cette PR — seule la forme de l'élément lui-même (objet, jamais null/
// primitif) et le type de reference/conditionnement (string ou absent/null) sont vérifiés.
// Pas de .strict() : une clé surnuméraire sur une ligne doit continuer d'être ignorée, jamais
// rejetée (cohérent avec le reste de l'API, voir erreursEcritureFK.test.ts).
const schemaLigneImport = z
  .object({
    designation: z.unknown(),
    reference: z.string().nullable().optional(),
    conditionnement: z.string().nullable().optional(),
    prix: z.unknown().optional(),
  })
  .passthrough();

const schemaLignesImport = z.array(schemaLigneImport).min(1);

// PR H de l'audit F09/F10 : valide UNIQUEMENT la structure qui fait aujourd'hui crasher
// POST /documents/:documentId/valider en 500 (élément non-objet/null dans `decisions`, ou
// `ligneId` de type non-exploitable par le `findUnique` qui le lit directement) — jamais le
// métier de `decision`/`articleRetenuId`, qui reste géré exactement comme avant cette PR : une
// valeur de `decision` autre que "REJETEE" continue de tenter la voie VALIDEE (comportement déjà
// préservé ailleurs dans cette API, voir le rapport d'audit) et un `articleRetenuId` absent/null/
// mal typé continue d'aboutir à une ligne "refusée" via les comparaisons strictes déjà en place,
// jamais un crash — ces deux champs n'ont donc aucun besoin d'être typés ici pour éliminer un
// risque réel. Pas de `.strict()` : une clé surnuméraire doit continuer d'être ignorée, jamais
// rejetée (même principe que schemaLigneImport ci-dessus).
const schemaDecision = z.object({ ligneId: z.number().int().positive() }).passthrough();
const schemaDecisions = z.array(schemaDecision).min(1);

// Étape 1 (facultative, pas de persistance) : extraction par vision IA d'une photo de listing —
// voir server/utils/importListingPhotoIA.ts. Si l'IA n'est pas configurée (503), le client bascule
// sur le repli OCR local existant (extraireTexteDePhoto, déjà utilisé pour les recettes) puis une
// analyse par règles côté client, exactement comme /recettes/import-ia (même contrat d'erreur).
router.post("/import-ia", async (req: Request, res: Response) => {
  try {
    const { photoDataUrl } = req.body as { photoDataUrl?: string };
    if (!photoDataUrl) {
      res.status(400).json({ error: "Photo de listing requise" });
      return;
    }

    const lignes = await extraireLignesListingPhoto(photoDataUrl);
    res.json({ lignes });
  } catch (error) {
    if (error instanceof ImportIANonConfigureError) {
      res.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof PhotoInvalideError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'analyser cette photo de listing" });
  }
});

// Équivalent pour une facture (Phase 6) : mêmes contrats d'erreur, extraction enrichie de
// numero/dateDocument/montantTotal en plus des lignes — voir importFacturePhotoIA.ts.
router.post("/factures/import-ia", async (req: Request, res: Response) => {
  try {
    const { photoDataUrl } = req.body as { photoDataUrl?: string };
    if (!photoDataUrl) {
      res.status(400).json({ error: "Photo de facture requise" });
      return;
    }

    const extraction = await extraireFacturePhoto(photoDataUrl);
    res.json(extraction);
  } catch (error) {
    if (error instanceof ImportIANonConfigureError) {
      res.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof PhotoInvalideError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'analyser cette photo de facture" });
  }
});

type LigneEntree = {
  designation: string;
  reference?: string | null;
  prix?: string | null;
  conditionnement?: string | null;
};

// Construit le contexte de rapprochement (candidats + alias + codes produit fournisseur connus)
// une seule fois par import — partagé entre l'import de listing et l'import de facture, jamais
// dupliqué (voir rapprochementFournisseur.ts, Phase 3). Les codes produit fournisseur sont
// TOUJOURS scopés à fournisseurId (jamais toutes sociétés/fournisseurs confondus, voir
// ProduitFournisseur : un même code peut légitimement désigner deux produits différents chez deux
// fournisseurs distincts).
async function construireContexteRapprochement(fournisseurId: number, societeId: number) {
  const [uniteKg, uniteL, articlesExistants, aliasExistants, produitsFournisseurExistants] = await Promise.all([
    prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } }),
    prisma.unite.findFirst({ where: { symbole: { equals: "l", mode: "insensitive" } } }),
    prisma.article.findMany({
      where: { societeId, actif: true },
      select: { id: true, nom: true, reference: true },
    }),
    prisma.aliasIngredientImport.findMany({ select: { texteNormalise: true, articleId: true } }),
    prisma.produitFournisseur.findMany({
      where: { fournisseurId },
      select: { codeProduitFournisseur: true, articleId: true, designationConnue: true },
    }),
  ]);

  const tarifsActifs = await prisma.tarifArticle.findMany({
    where: { actif: true, articleId: { in: articlesExistants.map((a) => a.id) } },
    orderBy: { dateDebut: "desc" },
    include: { unite: true },
  });
  const tarifActifParArticle = new Map<number, (typeof tarifsActifs)[number]>();
  for (const t of tarifsActifs) {
    if (!tarifActifParArticle.has(t.articleId)) tarifActifParArticle.set(t.articleId, t);
  }

  const candidats: CandidatRapprochement[] = articlesExistants.map((a) => ({
    articleId: a.id,
    nom: a.nom,
    reference: a.reference,
    uniteActiveType: tarifActifParArticle.get(a.id)?.unite.type ?? null,
  }));

  const contexte: ContexteRapprochement = {
    candidats,
    aliasParTexteNormalise: new Map(aliasExistants.map((a) => [a.texteNormalise, a.articleId])),
    produitsFournisseurConnus: new Map(
      produitsFournisseurExistants.map((p) => [
        normaliserCodeProduitFournisseur(p.codeProduitFournisseur),
        { articleId: p.articleId, designationConnue: p.designationConnue },
      ])
    ),
  };

  return { contexte, uniteKg, uniteL };
}

// Crée les LigneDocumentFournisseur niveau A + rapprochement niveau B pour un document déjà créé —
// partagé entre listing et facture (Phase 6), comportement strictement identique à celui déjà
// validé par les tests Phase 4 pour le listing (aucune ligne de cette fonction n'a été modifiée
// dans sa logique, seulement extraite telle quelle de POST /:fournisseurId).
async function creerLignesDocument(
  tx: Prisma.TransactionClient,
  documentId: number,
  lignes: LigneEntree[],
  contexte: ContexteRapprochement,
  uniteKg: { id: number; type: string } | null,
  uniteL: { id: number; type: string } | null
) {
  const lignesCreees = [];
  for (const ligneEntree of lignes) {
    const designation = String(ligneEntree.designation ?? "").trim();
    if (!designation) continue;

    const reference = ligneEntree.reference?.trim() || null;
    const conditionnement = ligneEntree.conditionnement?.trim() || null;
    const prixLu = parsePrix(ligneEntree.prix);
    const natureLigne = detecterNatureLigne(designation);

    // Une ligne qui n'est pas un article tarifable (frais de livraison, avoir, remise, non
    // alimentaire) n'entre jamais dans le rapprochement — voir cadrage §6/§7 : reste visible
    // (niveau A conservé) mais sans proposition B, decision reste EN_ATTENTE par défaut.
    if (natureLigne !== "ARTICLE") {
      const ligneCreee = await tx.ligneDocumentFournisseur.create({
        data: {
          documentId,
          designationLue: designation,
          referenceLue: reference,
          conditionnementLu: conditionnement,
          prixLu,
          natureLigne,
        },
      });
      lignesCreees.push(ligneCreee);
      continue;
    }

    const quantiteDetectee = extraireQuantiteDesignation(designation, conditionnement ?? undefined);
    // Uniquement la famille RÉELLEMENT détectée dans le texte (poids/volume) — jamais le repli
    // "pièce" utilisé ailleurs pour le calcul du prix : une désignation sans indication d'unité
    // ne doit jamais être traitée comme une confirmation "vendu à la pièce" pour le filtre de
    // cohérence (voir rapprochementFournisseur.ts), qui doit alors rester neutre (null = inconnu).
    const uniteDetecteeType =
      quantiteDetectee?.unite === "kg" ? (uniteKg?.type ?? null) : quantiteDetectee?.unite === "l" ? (uniteL?.type ?? null) : null;

    const resultat = rapprocherLigne(designation, reference, uniteDetecteeType, contexte);

    const donneesLigne = {
      documentId,
      designationLue: designation,
      referenceLue: reference,
      quantiteLue: quantiteDetectee?.quantite ?? null,
      uniteLue: quantiteDetectee?.unite ?? null,
      conditionnementLu: conditionnement,
      prixLu,
      natureLigne,
      ...(resultat.cas === "certaine"
        ? { articleProposeId: resultat.articleId, confiance: 1, motifCorrespondance: resultat.motif }
        : resultat.cas === "approximative_unique"
          ? {
              articleProposeId: resultat.articleId,
              confiance: resultat.score,
              motifCorrespondance: "DESIGNATION_APPROXIMATIVE" as const,
            }
          : resultat.cas === "plusieurs_candidats"
            ? {
                candidatsAlternatifs: resultat.candidats as unknown as object,
                motifCorrespondance: "DESIGNATION_APPROXIMATIVE" as const,
              }
            : {}),
    };

    const ligneCreee = await tx.ligneDocumentFournisseur.create({ data: donneesLigne });
    lignesCreees.push(ligneCreee);
  }
  return lignesCreees;
}

// Étape 2 : stockage permanent du document + création des lignes niveau A + rapprochement niveau B
// (voir rapprochementFournisseur.ts, Phase 3, réutilisé tel quel). N'écrit strictement aucun
// TarifArticle ici — voir /documents/:documentId/valider pour le niveau C.
router.post("/:fournisseurId", async (req: Request, res: Response) => {
  try {
    const fournisseurId = Number(req.params.fournisseurId);
    if (!Number.isInteger(fournisseurId) || fournisseurId <= 0) {
      res.status(400).json({ error: "Identifiant fournisseur invalide" });
      return;
    }

    const { photoDataUrl, nomFichierOriginal, lignes } = req.body as {
      photoDataUrl?: string;
      nomFichierOriginal?: string;
      lignes?: LigneEntree[];
    };
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma).
    const societeId = req.utilisateur!.societeId;

    // Scopé par société : jamais permettre d'importer un listing pour un fournisseur d'une autre
    // société en devinant/énumérant simplement un id.
    const fournisseur = await prisma.fournisseur.findFirst({ where: { id: fournisseurId, societeId } });
    if (!fournisseur) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }
    // Un fournisseur soft-supprimé ne doit jamais recevoir silencieusement un nouvel import, même
    // par sélection explicite en menu déroulant (voir cadrage §8 : comportement cohérent dans TOUS
    // les pipelines) — réactivation explicite requise avant de réimporter.
    if (!fournisseur.actif) {
      res.status(409).json({
        error: `Le fournisseur "${fournisseur.nom}" existe mais est actuellement inactif : réactive-le explicitement avant d'importer.`,
        fournisseurId: fournisseur.id,
      });
      return;
    }

    if (!photoDataUrl) {
      res.status(400).json({ error: "Document (photo) requis" });
      return;
    }
    if (!Array.isArray(lignes) || lignes.length === 0) {
      res.status(400).json({ error: "Aucune ligne à importer" });
      return;
    }
    const lignesValidees = schemaLignesImport.safeParse(lignes);
    if (!lignesValidees.success) {
      res.status(400).json({ error: "Structure de lignes invalide", details: lignesValidees.error.flatten() });
      return;
    }

    // Stockage sur le volume AVANT toute création en base : si l'écriture du fichier échoue
    // (DocumentInvalideError : type/taille invalide), aucun DocumentFournisseur orphelin n'est créé.
    let documentStocke;
    try {
      documentStocke = await enregistrerDocument({ fournisseurId, dataUrl: photoDataUrl, nomFichierOriginal });
    } catch (erreur) {
      if (erreur instanceof DocumentInvalideError) {
        res.status(400).json({ error: erreur.message });
        return;
      }
      throw erreur;
    }

    const { contexte, uniteKg, uniteL } = await construireContexteRapprochement(fournisseurId, societeId);

    // Atomique : le document et toutes ses lignes sont créés dans une seule transaction — si une
    // ligne échoue en cours de boucle (erreur DB/interne), ni elle ni les lignes déjà écrites ni
    // le document lui-même ne doivent survivre (voir le rapport d'audit F09/F10, chantier
    // atomicité). Le fichier déjà stocké sur le volume reste hors de cette transaction : son
    // éventuel nettoyage en cas d'échec reste un chantier séparé, hors scope ici.
    const { document, lignesCreees } = await prisma.$transaction(async (tx) => {
      const document = await tx.documentFournisseur.create({
        data: {
          fournisseurId,
          type: "LISTING",
          statut: "EN_ATTENTE",
          cle: documentStocke.cle,
          typeMime: documentStocke.typeMime,
          tailleOctets: documentStocke.tailleOctets,
          nomFichierOriginal: documentStocke.nomFichierOriginal,
        },
      });

      const lignesCreees = await creerLignesDocument(tx, document.id, lignes, contexte, uniteKg, uniteL);
      return { document, lignesCreees };
    });

    res.status(201).json({ document, lignes: lignesCreees });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'importer ce listing" });
  }
});

// --- Phase 6 : factures fournisseurs ---

type NiveauDoublon = "FORTE" | "FAIBLE";

type CorrespondanceDoublon = {
  documentId: number;
  numero: string | null;
  dateDocument: string | null;
  montantTotal: number | null;
  importeLe: string;
  niveau: NiveauDoublon;
};

// Exportées pour un test unitaire ciblé de la logique de déduplication, indépendant du contrat
// HTTP complet de la route (voir tests/unit/detectionDoublonFacture.test.ts).
export type { NiveauDoublon, CorrespondanceDoublon };

// Compare deux dates au jour près (jamais à l'heure près : une facture n'a pas d'heure réelle, et
// l'OCR/la sérialisation JSON peuvent introduire un décalage d'heure sans changer le jour réel).
export function memeJour(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function memeMontant(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

// Détection de doublon (Phase 6, option C validée) : critère 1 = fournisseurId + numero exact
// (trim seul, jamais insensible à la casse — "exact" au sens strict). Sans numero, aucune
// détection n'est tentée ni déduite d'autres champs (jamais un doublon inventé à partir d'une
// donnée absente). Purement informatif : ne bloque jamais, ne supprime/fusionne/écrase jamais rien.
export async function detecterDoublonFacture(
  fournisseurId: number,
  numero: string | null,
  dateDocument: Date | null,
  montantTotal: number | null
): Promise<{ niveau: NiveauDoublon; correspondances: CorrespondanceDoublon[] } | null> {
  const numeroTrim = numero?.trim();
  if (!numeroTrim) return null;

  const correspondancesExistantes = await prisma.documentFournisseur.findMany({
    where: { fournisseurId, type: "FACTURE", numero: numeroTrim },
  });
  if (correspondancesExistantes.length === 0) return null;

  const correspondances: CorrespondanceDoublon[] = correspondancesExistantes.map((doc) => {
    const dateCorrespond = Boolean(dateDocument && doc.dateDocument && memeJour(dateDocument, doc.dateDocument));
    const montantCorrespond = Boolean(
      montantTotal !== null && doc.montantTotal !== null && memeMontant(montantTotal, doc.montantTotal)
    );
    return {
      documentId: doc.id,
      numero: doc.numero,
      dateDocument: doc.dateDocument?.toISOString() ?? null,
      montantTotal: doc.montantTotal,
      importeLe: doc.importeLe.toISOString(),
      niveau: dateCorrespond && montantCorrespond ? "FORTE" : "FAIBLE",
    };
  });

  const niveau: NiveauDoublon = correspondances.some((c) => c.niveau === "FORTE") ? "FORTE" : "FAIBLE";
  return { niveau, correspondances };
}

// Import d'une facture : mêmes garanties que le listing (stockage avant écriture, rapprochement
// niveau B, aucun TarifArticle créé ici) plus la détection de doublon AVANT toute création
// définitive de DocumentFournisseur. Si un doublon est détecté et non confirmé explicitement par
// le client (confirmerDoublon), la réponse est purement informative : rien n'est stocké ni créé —
// ni fichier, ni document, ni ligne — le client doit rappeler cette même route avec
// confirmerDoublon:true une fois la décision humaine prise pour que l'import ait réellement lieu.
router.post("/factures/:fournisseurId", async (req: Request, res: Response) => {
  try {
    const fournisseurId = Number(req.params.fournisseurId);
    if (!Number.isInteger(fournisseurId) || fournisseurId <= 0) {
      res.status(400).json({ error: "Identifiant fournisseur invalide" });
      return;
    }

    const { photoDataUrl, nomFichierOriginal, lignes, numero, dateDocument, montantTotal, confirmerDoublon } =
      req.body as {
        photoDataUrl?: string;
        nomFichierOriginal?: string;
        lignes?: LigneEntree[];
        numero?: string | null;
        dateDocument?: string | null;
        montantTotal?: number | null;
        confirmerDoublon?: boolean;
      };
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma).
    const societeId = req.utilisateur!.societeId;

    // Scopé par société : jamais permettre d'importer une facture pour un fournisseur d'une autre
    // société en devinant/énumérant simplement un id.
    const fournisseur = await prisma.fournisseur.findFirst({ where: { id: fournisseurId, societeId } });
    if (!fournisseur) {
      res.status(404).json({ error: "Fournisseur introuvable" });
      return;
    }
    // Un fournisseur soft-supprimé ne doit jamais recevoir silencieusement un nouvel import, même
    // par sélection explicite en menu déroulant (voir cadrage §8 : comportement cohérent dans TOUS
    // les pipelines) — réactivation explicite requise avant de réimporter.
    if (!fournisseur.actif) {
      res.status(409).json({
        error: `Le fournisseur "${fournisseur.nom}" existe mais est actuellement inactif : réactive-le explicitement avant d'importer.`,
        fournisseurId: fournisseur.id,
      });
      return;
    }

    if (!photoDataUrl) {
      res.status(400).json({ error: "Document (photo) requis" });
      return;
    }
    if (!Array.isArray(lignes) || lignes.length === 0) {
      res.status(400).json({ error: "Aucune ligne à importer" });
      return;
    }
    const lignesValidees = schemaLignesImport.safeParse(lignes);
    if (!lignesValidees.success) {
      res.status(400).json({ error: "Structure de lignes invalide", details: lignesValidees.error.flatten() });
      return;
    }

    const dateDocumentParsee = dateDocument ? new Date(dateDocument) : null;
    const montantTotalNombre = typeof montantTotal === "number" ? montantTotal : null;

    // Détection AVANT toute création — comparée aux données réellement en base, jamais à une
    // liste fournie par le client (voir règle 11 du cadrage).
    if (!confirmerDoublon) {
      const doublon = await detecterDoublonFacture(fournisseurId, numero ?? null, dateDocumentParsee, montantTotalNombre);
      if (doublon) {
        res.json({ doublon });
        return;
      }
    }

    // Stockage sur le volume AVANT toute création en base : si l'écriture du fichier échoue
    // (DocumentInvalideError : type/taille invalide), aucun DocumentFournisseur orphelin n'est créé.
    let documentStocke;
    try {
      documentStocke = await enregistrerDocument({ fournisseurId, dataUrl: photoDataUrl, nomFichierOriginal });
    } catch (erreur) {
      if (erreur instanceof DocumentInvalideError) {
        res.status(400).json({ error: erreur.message });
        return;
      }
      throw erreur;
    }

    const { contexte, uniteKg, uniteL } = await construireContexteRapprochement(fournisseurId, societeId);

    // Atomique : le document et toutes ses lignes sont créés dans une seule transaction — si une
    // ligne échoue en cours de boucle (erreur DB/interne), ni elle ni les lignes déjà écrites ni
    // le document lui-même ne doivent survivre (voir le rapport d'audit F09/F10, chantier
    // atomicité). Le fichier déjà stocké sur le volume reste hors de cette transaction : son
    // éventuel nettoyage en cas d'échec reste un chantier séparé, hors scope ici.
    const { document, lignesCreees } = await prisma.$transaction(async (tx) => {
      const document = await tx.documentFournisseur.create({
        data: {
          fournisseurId,
          type: "FACTURE",
          statut: "EN_ATTENTE",
          cle: documentStocke.cle,
          typeMime: documentStocke.typeMime,
          tailleOctets: documentStocke.tailleOctets,
          nomFichierOriginal: documentStocke.nomFichierOriginal,
          numero: numero?.trim() || null,
          dateDocument: dateDocumentParsee,
          montantTotal: montantTotalNombre,
        },
      });

      const lignesCreees = await creerLignesDocument(tx, document.id, lignes, contexte, uniteKg, uniteL);
      return { document, lignesCreees };
    });

    res.status(201).json({ document, lignes: lignesCreees });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'importer cette facture" });
  }
});

// Détail d'un document déjà importé (onglet "Listings"/"Factures" de la fiche fournisseur) : relit
// depuis la base ce qui a été persisté, jamais reconstruit à partir de ce que le client prétend
// avoir reçu à l'import — un document ancien doit rester consultable à l'identique bien après sa
// création. Générique LISTING/FACTURE (le champ `type` du document renvoyé suffit à distinguer).
router.get("/documents/:documentId", async (req: Request, res: Response) => {
  try {
    const documentId = Number(req.params.documentId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      res.status(400).json({ error: "Identifiant de document invalide" });
      return;
    }

    // Scopé par société via le fournisseur : jamais permettre de consulter le document d'un
    // fournisseur d'une autre société en devinant/énumérant simplement un id.
    const document = await prisma.documentFournisseur.findFirst({
      where: { id: documentId, fournisseur: { societeId: req.utilisateur!.societeId } },
      include: {
        lignes: {
          include: {
            articlePropose: { select: { id: true, nom: true } },
            articleRetenu: { select: { id: true, nom: true } },
          },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!document) {
      res.status(404).json({ error: "Document introuvable" });
      return;
    }

    res.json(document);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer ce document" });
  }
});

type Decision = { ligneId: number; decision: "VALIDEE" | "REJETEE"; articleRetenuId?: number };

// Étape 3 : applique le niveau C — jamais avant une décision humaine explicite, et jamais en se
// fiant à la proposition telle que connue du client : chaque ligne est relue depuis la base et
// l'articleRetenuId est revérifié contre CE QUI EST RÉELLEMENT PROPOSÉ à cet instant (même
// principe que PR #79 / POST /articles/import : une proposition n'est jamais une décision).
// Générique LISTING/FACTURE (ne dépend jamais de document.type).
router.post("/documents/:documentId/valider", async (req: Request, res: Response) => {
  try {
    const documentId = Number(req.params.documentId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      res.status(400).json({ error: "Identifiant de document invalide" });
      return;
    }

    const analyseDecisions = schemaDecisions.safeParse(req.body.decisions);
    if (!analyseDecisions.success) {
      res.status(400).json({ error: "Décisions invalides", details: analyseDecisions.error.flatten() });
      return;
    }
    const decisions = analyseDecisions.data as Decision[];

    // Scopé par société via le fournisseur : jamais permettre de valider le document d'un
    // fournisseur d'une autre société en devinant/énumérant simplement un id.
    const document = await prisma.documentFournisseur.findFirst({
      where: { id: documentId, fournisseur: { societeId: req.utilisateur!.societeId } },
    });
    if (!document) {
      res.status(404).json({ error: "Document introuvable" });
      return;
    }

    const [uniteKg, uniteL, unitePiece, conditionnement] = await Promise.all([
      prisma.unite.findFirst({ where: { symbole: { equals: "kg", mode: "insensitive" } } }),
      prisma.unite.findFirst({ where: { symbole: { equals: "l", mode: "insensitive" } } }),
      prisma.unite.findFirst({ where: { symbole: { equals: "pièce", mode: "insensitive" } } }),
      prisma.conditionnement.findFirst({ orderBy: { id: "asc" } }),
    ]);
    if (!conditionnement) {
      res.status(500).json({ error: "Aucun conditionnement configuré" });
      return;
    }

    // Atomique : toutes les décisions de ce lot et la mise à jour finale du statut du document
    // sont appliquées dans une seule transaction — si une décision pourtant valide échoue en cours
    // de boucle (erreur DB/interne), ni elle ni les décisions déjà traitées plus tôt dans ce même
    // appel ne doivent survivre, et le document ne doit jamais rester EN_ATTENTE alors qu'une de
    // ses lignes a déjà changé d'état (voir le rapport d'audit F09/F10, chantier validation +
    // atomicité des décisions). Remplace l'ancien design : une transaction indépendante par
    // décision VALIDEE, suivie d'une mise à jour du document hors transaction en fin de boucle.
    const { valides, rejetees, refusees } = await prisma.$transaction(async (tx) => {
      let valides = 0;
      let rejetees = 0;
      const refusees: string[] = [];

      for (const decisionEntree of decisions) {
        const ligne = await tx.ligneDocumentFournisseur.findUnique({
          where: { id: decisionEntree.ligneId },
        });
        if (!ligne || ligne.documentId !== documentId) {
          refusees.push(`Ligne ${decisionEntree.ligneId} introuvable pour ce document`);
          continue;
        }
        // Une ligne déjà traitée (décision précédente non EN_ATTENTE) n'est jamais retraitée en
        // silence — évite qu'un second appel dupliquerait un TarifArticle déjà créé.
        if (ligne.decision !== "EN_ATTENTE") {
          refusees.push(`Ligne ${decisionEntree.ligneId} déjà traitée`);
          continue;
        }

        if (decisionEntree.decision === "REJETEE") {
          await tx.ligneDocumentFournisseur.update({
            where: { id: ligne.id },
            data: { decision: "REJETEE" },
          });
          rejetees++;
          continue;
        }

        // decision === "VALIDEE" : l'articleRetenuId doit être exactement celui proposé (cas
        // "certaine"/"approximative_unique"), ou l'un des candidats alternatifs proposés (cas
        // "plusieurs_candidats") — jamais un article arbitraire choisi par confiance dans le client.
        const candidatsAlternatifs = Array.isArray(ligne.candidatsAlternatifs)
          ? (ligne.candidatsAlternatifs as { articleId: number }[])
          : [];
        const choixValide =
          decisionEntree.articleRetenuId !== undefined &&
          (decisionEntree.articleRetenuId === ligne.articleProposeId ||
            candidatsAlternatifs.some((c) => c.articleId === decisionEntree.articleRetenuId));

        if (!choixValide) {
          refusees.push(`Ligne ${decisionEntree.ligneId} : article retenu non conforme à la proposition`);
          continue;
        }
        const articleRetenuId = decisionEntree.articleRetenuId!;

        if (ligne.prixLu === null) {
          refusees.push(`Ligne ${decisionEntree.ligneId} : prix illisible, aucun tarif ne peut être créé`);
          continue;
        }

        const quantiteDetectee = extraireQuantiteDesignation(ligne.designationLue, ligne.conditionnementLu ?? undefined);
        const uniteAAppliquer =
          quantiteDetectee?.unite === "kg" ? uniteKg : quantiteDetectee?.unite === "l" ? uniteL : unitePiece;
        if (!uniteAAppliquer) {
          refusees.push(`Ligne ${decisionEntree.ligneId} : aucune unité disponible`);
          continue;
        }
        const prixHT = quantiteDetectee && quantiteDetectee.quantite > 0
          ? Math.round((ligne.prixLu / quantiteDetectee.quantite) * 10000) / 10000
          : ligne.prixLu;

        // Scopé par (articleId, fournisseurId) — jamais articleId seul (voir cadrage « identité
        // fournisseur + produit fournisseur + historique des tarifs », correction du bug critique :
        // la validation d'un document d'un fournisseur B ne doit jamais clôturer le tarif actif d'un
        // AUTRE fournisseur A pour ce même article).
        const tarifActif = await tx.tarifArticle.findFirst({
          where: { articleId: articleRetenuId, fournisseurId: document.fournisseurId, actif: true },
        });

        // Une décision humaine explicite sur cette ligne vaut confirmation du couple (code, article)
        // pour tous les imports futurs de CE fournisseur (listing ou facture) — voir
        // server/utils/produitFournisseur.ts. Rien si aucun code n'a été lu sur ce document (jamais de
        // code inventé) ; ne remplace jamais un lien déjà existant pour ce code (résolution en lecture
        // seule si déjà connu).
        const codeProduitLigne = ligne.referenceLue ? normaliserCodeProduitFournisseur(ligne.referenceLue) : null;

        let produitFournisseurId: number | null = null;
        if (codeProduitLigne) {
          const produitFournisseur = await resoudreOuCreerProduitFournisseur(
            tx,
            document.fournisseurId,
            codeProduitLigne,
            articleRetenuId,
            ligne.designationLue
          );
          produitFournisseurId = produitFournisseur.id;
        }

        if (tarifActif) {
          await tx.tarifArticle.update({
            where: { id: tarifActif.id },
            data: { actif: false, dateFin: new Date() },
          });
        }
        const tarifCree = await tx.tarifArticle.create({
          data: {
            articleId: articleRetenuId,
            fournisseurId: document.fournisseurId,
            uniteId: uniteAAppliquer.id,
            conditionnementId: conditionnement.id,
            quantiteConditionnement: 1,
            prixHT,
            produitFournisseurId,
          },
        });
        await tx.ligneDocumentFournisseur.update({
          where: { id: ligne.id },
          data: { decision: "VALIDEE", articleRetenuId, tarifCreeId: tarifCree.id },
        });

        valides++;
      }

      await tx.documentFournisseur.update({ where: { id: documentId }, data: { statut: "VALIDE" } });

      return { valides, rejetees, refusees };
    });

    res.json({ valides, rejetees, refusees });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'appliquer les décisions" });
  }
});

export default router;
