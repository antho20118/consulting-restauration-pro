import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { normaliserTexte } from "../utils/normaliserTexte.js";
import { parsePrix } from "../utils/importListing.js";
import {
  rapprocherLigneVente,
  type CandidatRecetteVente,
  type ContexteRapprochementVente,
  type ResultatRapprochementVente,
} from "../utils/rapprochementVentes.js";
import { calculerCoutsRecettesSansErreur, inclusionsRecette } from "../utils/coutRecette.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// PR F de l'audit F09/F10 : valide UNIQUEMENT la structure qui fait aujourd'hui crasher
// POST /import en 500 (élément non-objet/null dans lignes, periodeDebut/periodeFin non
// parsable) — jamais le métier de decision/quantite/prixUnitaire/recetteRetenueId, qui reste
// hors scope (voir le rapport d'audit). Chaque élément de `lignes` n'est validé que comme "objet
// non-null" (schéma sans aucune clé déclarée, passthrough) : designation, quantite, prixUnitaire,
// decision, recetteRetenueId continuent de traverser ce schéma sans être typés ni rejetés,
// exactement comme avant cette PR — seule la forme de l'élément lui-même (objet, jamais null/
// primitif) est vérifiée. Pas de .strict() sur les lignes ni sur le corps : une clé surnuméraire
// doit continuer d'être ignorée, jamais rejetée.
const schemaLigneVenteImport = z.object({}).passthrough();

// periodeDebut/periodeFin : le comportement actuel traite toute valeur falsy (absente, null,
// chaîne vide) comme "non renseignée" (-> null), et toute valeur truthy est passée telle quelle à
// `new Date(...)`. On préserve ce comportement à l'identique pour le cas falsy, et on exige
// seulement qu'une valeur truthy produise une Date valide — jamais de contrainte de type (string
// vs number) non prouvée par le contrat existant.
function dateOptionnelleValide(valeur: unknown): boolean {
  if (!valeur) return true;
  return !Number.isNaN(new Date(valeur as string).getTime());
}

const schemaDateOptionnelle = z.unknown().refine(dateOptionnelleValide, { message: "Date invalide" });

const schemaCorpsImportVentes = z
  .object({
    periodeDebut: schemaDateOptionnelle.optional(),
    periodeFin: schemaDateOptionnelle.optional(),
    lignes: z.array(schemaLigneVenteImport).min(1),
  })
  .passthrough();

type LigneEntree = {
  designation?: string;
  quantite?: unknown;
  prixUnitaire?: unknown;
};

async function construireContexteVentes(societeId: number): Promise<ContexteRapprochementVente> {
  const [recettesExistantes, aliasExistants] = await Promise.all([
    prisma.recette.findMany({ where: { societeId, actif: true }, select: { id: true, nom: true } }),
    prisma.aliasProduitVenduImport.findMany({ select: { texteNormalise: true, recetteId: true } }),
  ]);

  const candidats: CandidatRecetteVente[] = recettesExistantes.map((r) => ({ recetteId: r.id, nom: r.nom }));
  const aliasParTexteNormalise = new Map(aliasExistants.map((a) => [a.texteNormalise, a.recetteId]));

  return { candidats, aliasParTexteNormalise };
}

function parseQuantite(val: unknown): number | null {
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  const nb = parseFloat(String(val ?? "").replace(",", "."));
  return Number.isFinite(nb) ? nb : null;
}

// Résultat de rapprochement traduit en champs directement stockables sur une LigneVente — factorisé
// entre l'aperçu et l'écriture réelle pour ne jamais faire diverger les deux (même principe que
// creerLignesDocument, listingsFournisseur.ts).
function champsProposition(resultat: ResultatRapprochementVente) {
  if (resultat.cas === "certaine") {
    return { recetteProposeeId: resultat.recetteId, confiance: 1, motifCorrespondance: resultat.motif, candidatsAlternatifs: undefined as object | undefined };
  }
  if (resultat.cas === "approximative_unique") {
    return {
      recetteProposeeId: resultat.recetteId,
      confiance: resultat.score,
      motifCorrespondance: "DESIGNATION_APPROXIMATIVE" as const,
      candidatsAlternatifs: undefined as object | undefined,
    };
  }
  if (resultat.cas === "plusieurs_candidats") {
    return {
      recetteProposeeId: null,
      confiance: null,
      motifCorrespondance: "DESIGNATION_APPROXIMATIVE" as const,
      candidatsAlternatifs: resultat.candidats as unknown as object,
    };
  }
  return { recetteProposeeId: null, confiance: null, motifCorrespondance: null, candidatsAlternatifs: undefined as object | undefined };
}

// Un choix de recette n'est jamais accepté par confiance dans le client : il doit être exactement
// celui proposé (cas "certaine"/"approximative_unique"), ou l'un des candidats alternatifs proposés
// (cas "plusieurs_candidats") — jamais une recette arbitraire, même valide par ailleurs (même
// principe que POST /listings-fournisseur/documents/:id/valider).
function choixRecetteValide(resultat: ResultatRapprochementVente, recetteRetenueId: number): boolean {
  if (resultat.cas === "certaine" || resultat.cas === "approximative_unique") {
    return resultat.recetteId === recetteRetenueId;
  }
  if (resultat.cas === "plusieurs_candidats") {
    return resultat.candidats.some((c) => c.recetteId === recetteRetenueId);
  }
  return false;
}

// Prévisualisation en lecture seule d'un import de ventes (export CSV/Excel d'une caisse
// enregistreuse, déjà parsé côté frontend) : produit, pour chaque ligne, la MÊME proposition que
// POST /import écrira réellement (rapprocherLigneVente), sans jamais créer ni modifier le moindre
// DocumentVentes, LigneVente ou AliasProduitVenduImport.
router.post("/import/apercu", async (req: Request, res: Response) => {
  try {
    const { lignes } = req.body as { lignes?: LigneEntree[] };
    if (!Array.isArray(lignes) || lignes.length === 0) {
      res.status(400).json({ error: "Aucune ligne à analyser" });
      return;
    }

    const contexte = await construireContexteVentes(req.utilisateur!.societeId);
    const nomParRecetteId = new Map(contexte.candidats.map((c) => [c.recetteId, c.nom]));

    const propositions = lignes.map((ligne, index) => {
      const designation = String(ligne.designation ?? "").trim();
      const quantite = parseQuantite(ligne.quantite);
      const prixUnitaire = parsePrix(ligne.prixUnitaire);

      if (!designation || quantite === null || quantite <= 0) {
        return {
          index,
          designationLue: designation,
          quantiteVendue: quantite,
          prixVenteUnitaireLu: prixUnitaire,
          statut: "invalide" as const,
          motif: !designation ? "Désignation manquante" : "Quantité illisible",
        };
      }

      const resultat = rapprocherLigneVente(designation, contexte);
      const propose = champsProposition(resultat);
      return {
        index,
        designationLue: designation,
        quantiteVendue: quantite,
        prixVenteUnitaireLu: prixUnitaire,
        statut: resultat.cas,
        ...propose,
        recetteProposeeNom: propose.recetteProposeeId ? (nomParRecetteId.get(propose.recetteProposeeId) ?? null) : null,
      };
    });

    res.json({ lignes: propositions });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'analyser ce fichier de ventes" });
  }
});

type LigneDecisionEntree = LigneEntree & {
  decision?: "VALIDEE" | "REJETEE";
  recetteRetenueId?: number;
};

// Écriture réelle d'un import de ventes : RE-ÉVALUE chaque ligne au moment de l'écriture (jamais
// une confiance dans la proposition connue du client, même principe que POST /articles/import) et
// n'accepte une décision "VALIDEE" que si la recette retenue correspond exactement à ce qui est
// réellement proposé à cet instant. Une ligne dont la nature ne peut pas être rapprochée de façon
// fiable, ou explicitement rejetée par l'utilisateur, ne crée jamais de recette : voir
// MotifCorrespondanceVente (prisma/schema.prisma), une recette ne pouvant pas être déduite d'un
// simple nom et d'un prix.
router.post("/import", async (req: Request, res: Response) => {
  try {
    const { nomFichierOriginal, periodeDebut, periodeFin, lignes } = req.body as {
      nomFichierOriginal?: string;
      periodeDebut?: string;
      periodeFin?: string;
      lignes?: LigneDecisionEntree[];
    };

    if (!Array.isArray(lignes) || lignes.length === 0) {
      res.status(400).json({ error: "Aucune ligne à importer" });
      return;
    }
    const corpsValide = schemaCorpsImportVentes.safeParse(req.body);
    if (!corpsValide.success) {
      res.status(400).json({ error: "Corps d'import invalide", details: corpsValide.error.flatten() });
      return;
    }

    const societeId = req.utilisateur!.societeId;
    const contexte = await construireContexteVentes(societeId);

    const document = await prisma.documentVentes.create({
      data: {
        societeId,
        periodeDebut: periodeDebut ? new Date(periodeDebut) : null,
        periodeFin: periodeFin ? new Date(periodeFin) : null,
        nomFichierOriginal: nomFichierOriginal || null,
        creeParId: req.utilisateur!.id,
      },
    });

    let validees = 0;
    let rejetees = 0;
    let enAttente = 0;
    const erreurs: string[] = [];
    // Alias appris à la volée pendant CET import : une même désignation revenant plusieurs fois
    // dans le même fichier doit profiter de l'alias appris par une ligne précédente, sans attendre
    // le prochain import (jamais rechargé depuis la base au milieu de la boucle).
    const aliasAppris = new Map<string, number>();

    for (const ligneEntree of lignes) {
      const designation = String(ligneEntree.designation ?? "").trim();
      const quantite = parseQuantite(ligneEntree.quantite);
      const prixUnitaire = parsePrix(ligneEntree.prixUnitaire);

      if (!designation || quantite === null || quantite <= 0) {
        erreurs.push(`Ligne "${designation || "(vide)"}" ignorée : désignation ou quantité invalide`);
        continue;
      }

      const designationNormalisee = normaliserTexte(designation);
      const contexteLigne: ContexteRapprochementVente = aliasAppris.has(designationNormalisee)
        ? { candidats: contexte.candidats, aliasParTexteNormalise: new Map(contexte.aliasParTexteNormalise).set(designationNormalisee, aliasAppris.get(designationNormalisee)!) }
        : contexte;

      const resultat = rapprocherLigneVente(designation, contexteLigne);
      const propose = champsProposition(resultat);

      const decisionDemandee = ligneEntree.decision;

      if (decisionDemandee === "REJETEE" || decisionDemandee === undefined) {
        await prisma.ligneVente.create({
          data: {
            documentVentesId: document.id,
            designationLue: designation,
            quantiteVendue: quantite,
            prixVenteUnitaireLu: prixUnitaire,
            recetteProposeeId: propose.recetteProposeeId,
            confiance: propose.confiance,
            motifCorrespondance: propose.motifCorrespondance,
            candidatsAlternatifs: propose.candidatsAlternatifs,
            decision: decisionDemandee === "REJETEE" ? "REJETEE" : "EN_ATTENTE",
          },
        });
        if (decisionDemandee === "REJETEE") rejetees++;
        else enAttente++;
        continue;
      }

      // decision === "VALIDEE"
      const recetteRetenueId = ligneEntree.recetteRetenueId;
      if (!recetteRetenueId || !choixRecetteValide(resultat, recetteRetenueId)) {
        erreurs.push(`Ligne "${designation}" : recette retenue non conforme à la proposition, ligne mise en attente`);
        await prisma.ligneVente.create({
          data: {
            documentVentesId: document.id,
            designationLue: designation,
            quantiteVendue: quantite,
            prixVenteUnitaireLu: prixUnitaire,
            recetteProposeeId: propose.recetteProposeeId,
            confiance: propose.confiance,
            motifCorrespondance: propose.motifCorrespondance,
            candidatsAlternatifs: propose.candidatsAlternatifs,
            decision: "EN_ATTENTE",
          },
        });
        enAttente++;
        continue;
      }

      await prisma.ligneVente.create({
        data: {
          documentVentesId: document.id,
          designationLue: designation,
          quantiteVendue: quantite,
          prixVenteUnitaireLu: prixUnitaire,
          recetteProposeeId: propose.recetteProposeeId,
          confiance: propose.confiance,
          motifCorrespondance: propose.motifCorrespondance,
          candidatsAlternatifs: propose.candidatsAlternatifs,
          decision: "VALIDEE",
          recetteRetenueId,
        },
      });
      validees++;

      // Apprentissage de l'alias : mémorise la correspondance confirmée par un humain pour le
      // prochain import portant la même désignation — jamais pour une ligne rejetée ou en attente.
      await prisma.aliasProduitVenduImport.upsert({
        where: { texteNormalise: designationNormalisee },
        create: { texteNormalise: designationNormalisee, recetteId: recetteRetenueId },
        update: { recetteId: recetteRetenueId },
      });
      aliasAppris.set(designationNormalisee, recetteRetenueId);
    }

    res.status(201).json({ document, validees, rejetees, enAttente, erreurs });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'importer ce fichier de ventes" });
  }
});

// Historique des imports de ventes de la société — pas de pagination : le volume (un document par
// import de fichier, pas par ligne) reste modeste par nature, même principe que
// GET /documents-fournisseurs.
router.get("/documents", async (req: Request, res: Response) => {
  try {
    const documents = await prisma.documentVentes.findMany({
      where: { societeId: req.utilisateur!.societeId },
      include: {
        creePar: { select: { identifiant: true } },
        _count: { select: { lignes: true } },
        lignes: { select: { decision: true } },
      },
      orderBy: { importeLe: "desc" },
    });

    const resultat = documents.map((d) => {
      const validees = d.lignes.filter((l) => l.decision === "VALIDEE").length;
      const rejetees = d.lignes.filter((l) => l.decision === "REJETEE").length;
      const enAttente = d.lignes.filter((l) => l.decision === "EN_ATTENTE").length;
      return {
        id: d.id,
        periodeDebut: d.periodeDebut,
        periodeFin: d.periodeFin,
        nomFichierOriginal: d.nomFichierOriginal,
        importeLe: d.importeLe,
        creeParIdentifiant: d.creePar?.identifiant ?? null,
        totalLignes: d._count.lignes,
        validees,
        rejetees,
        enAttente,
      };
    });

    res.json(resultat);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer l'historique des imports de ventes" });
  }
});

// Réconciliation food cost théorique (moteur de coût, à date) vs réel (ventes confirmées) par
// recette — jamais calculée à partir d'une ligne EN_ATTENTE ou REJETEE : seule une décision
// humaine explicite (VALIDEE) fait entrer une vente dans cet agrégat.
router.get("/reconciliation", async (req: Request, res: Response) => {
  try {
    const societeId = req.utilisateur!.societeId;
    const { depuis, jusqua } = req.query as { depuis?: string; jusqua?: string };

    const lignesValidees = await prisma.ligneVente.findMany({
      where: {
        decision: "VALIDEE",
        recetteRetenueId: { not: null },
        documentVentes: {
          societeId,
          ...(depuis ? { importeLe: { gte: new Date(depuis) } } : {}),
          ...(jusqua ? { importeLe: { lte: new Date(jusqua) } } : {}),
        },
      },
      select: { recetteRetenueId: true, quantiteVendue: true, prixVenteUnitaireLu: true },
    });

    if (lignesValidees.length === 0) {
      res.json({ recettes: [] });
      return;
    }

    const agregatParRecette = new Map<
      number,
      { quantiteVendue: number; chiffreAffairesReel: number; ventesSansPrix: number }
    >();
    for (const ligne of lignesValidees) {
      const recetteId = ligne.recetteRetenueId!;
      const agregat = agregatParRecette.get(recetteId) ?? {
        quantiteVendue: 0,
        chiffreAffairesReel: 0,
        ventesSansPrix: 0,
      };
      agregat.quantiteVendue += ligne.quantiteVendue;
      if (ligne.prixVenteUnitaireLu !== null) {
        agregat.chiffreAffairesReel += ligne.quantiteVendue * ligne.prixVenteUnitaireLu;
      } else {
        agregat.ventesSansPrix += ligne.quantiteVendue;
      }
      agregatParRecette.set(recetteId, agregat);
    }

    const recettes = await prisma.recette.findMany({
      where: { id: { in: [...agregatParRecette.keys()] } },
      include: inclusionsRecette,
    });
    const recettesAvecCout = calculerCoutsRecettesSansErreur(recettes);
    const coutParRecetteId = new Map(recettesAvecCout.map((r) => [r.id, r]));

    const resultat = [...agregatParRecette.entries()].map(([recetteId, agregat]) => {
      const recette = coutParRecetteId.get(recetteId);
      const coutTheoriqueTotal = recette ? agregat.quantiteVendue * recette.coutParPortion : null;
      // Chiffre d'affaires réel partiel (certaines lignes de vente n'ont pas de prix unitaire lu) :
      // jamais mélangé silencieusement à un prix théorique — signalé via ventesSansPrix plutôt que
      // reconstitué.
      const chiffreAffairesReel = agregat.ventesSansPrix === 0 ? agregat.chiffreAffairesReel : null;
      const foodCostReelPct =
        chiffreAffairesReel && chiffreAffairesReel > 0 && coutTheoriqueTotal !== null
          ? (coutTheoriqueTotal / chiffreAffairesReel) * 100
          : null;

      return {
        recetteId,
        recetteNom: recette?.nom ?? null,
        quantiteVendue: agregat.quantiteVendue,
        chiffreAffairesReel,
        ventesSansPrix: agregat.ventesSansPrix,
        coutTheoriqueUnitaire: recette?.coutParPortion ?? null,
        coutTheoriqueTotal,
        foodCostTheoriquePct: recette?.foodCostPct ?? null,
        foodCostReelPct,
      };
    });

    res.json({ recettes: resultat });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de calculer la réconciliation des ventes" });
  }
});

export type QuadrantMenuEngineering = "VEDETTE" | "CHEVAL_DE_TRAIT" | "ENIGME" | "POIDS_MORT";

// Méthode Kasavana & Smith (référence historique du menu engineering, pas une invention maison) :
// - Popularité : indice de popularité d'une recette = sa part du volume total vendu. Seuil = 70 %
//   de l'indice « équitable » (1/n si toutes les recettes vendaient pareil) — une recette est
//   populaire si elle atteint au moins ce seuil.
// - Rentabilité : marge unitaire (prix de vente actuel - coût matière actuel, jamais un prix ou
//   coût historique reconstitué) comparée à la marge moyenne PONDÉRÉE par les quantités vendues —
//   une recette jamais vendue pèse donc pour rien dans cette moyenne, sans fausser le classement
//   des recettes réellement vendues.
router.get("/menu-engineering", async (req: Request, res: Response) => {
  try {
    const societeId = req.utilisateur!.societeId;
    const { depuis, jusqua } = req.query as { depuis?: string; jusqua?: string };

    const [recettes, lignesValidees] = await Promise.all([
      prisma.recette.findMany({ where: { societeId, actif: true }, include: inclusionsRecette }),
      prisma.ligneVente.findMany({
        where: {
          decision: "VALIDEE",
          recetteRetenueId: { not: null },
          documentVentes: {
            societeId,
            ...(depuis ? { importeLe: { gte: new Date(depuis) } } : {}),
            ...(jusqua ? { importeLe: { lte: new Date(jusqua) } } : {}),
          },
        },
        select: { recetteRetenueId: true, quantiteVendue: true },
      }),
    ]);

    const quantiteParRecette = new Map<number, number>();
    for (const ligne of lignesValidees) {
      const id = ligne.recetteRetenueId!;
      quantiteParRecette.set(id, (quantiteParRecette.get(id) ?? 0) + ligne.quantiteVendue);
    }

    const recettesAvecCout = calculerCoutsRecettesSansErreur(recettes);

    // Seules les recettes avec un prix de vente configuré peuvent être évaluées ici — jamais une
    // marge inventée pour celles qui n'en ont pas (même principe que server/routes/consulting.ts).
    const items = recettesAvecCout
      .filter((r) => r.prixVenteHT != null && r.prixVenteHT > 0)
      .map((r) => ({
        recetteId: r.id,
        recetteNom: r.nom,
        quantiteVendue: quantiteParRecette.get(r.id) ?? 0,
        margeUnitaire: r.margeHT!,
        prixVenteHT: r.prixVenteHT!,
        coutParPortion: r.coutParPortion,
      }));

    if (items.length === 0) {
      res.json({ items: [], seuilPopulariteQuantite: null, margeMoyennePonderee: null });
      return;
    }

    const totalQuantite = items.reduce((total, item) => total + item.quantiteVendue, 0);
    const seuilPopulariteQuantite = totalQuantite > 0 ? 0.7 * (totalQuantite / items.length) : null;

    // Repli sur une moyenne non pondérée si aucune vente sur la période : la moyenne pondérée
    // (ci-dessous) vaudrait sinon 0/0, jamais un classement silencieusement faussé.
    const margeMoyennePonderee =
      totalQuantite > 0
        ? items.reduce((total, item) => total + item.margeUnitaire * item.quantiteVendue, 0) / totalQuantite
        : items.reduce((total, item) => total + item.margeUnitaire, 0) / items.length;

    const resultat = items.map((item) => {
      const populaire = seuilPopulariteQuantite !== null && item.quantiteVendue >= seuilPopulariteQuantite;
      const rentable = item.margeUnitaire >= margeMoyennePonderee;
      const quadrant: QuadrantMenuEngineering =
        populaire && rentable
          ? "VEDETTE"
          : populaire && !rentable
            ? "CHEVAL_DE_TRAIT"
            : !populaire && rentable
              ? "ENIGME"
              : "POIDS_MORT";
      return { ...item, populaire, rentable, quadrant };
    });

    res.json({ items: resultat, seuilPopulariteQuantite, margeMoyennePonderee, totalQuantiteVendue: totalQuantite });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de calculer le menu engineering" });
  }
});

export type TendancePrevision = "hausse" | "stable" | "baisse";

// Prévision de ventes — méthode volontairement simple et explicable (moyenne mobile), pas un
// modèle statistique sophistiqué : chaque DocumentVentes importé représente une période (ventes
// validées uniquement, voir /reconciliation). Nécessite au moins 2 périodes pour dire quoi que ce
// soit — jamais une prévision inventée à partir d'une seule période.
const SEUIL_TENDANCE_PCT = 10;

router.get("/previsions", async (req: Request, res: Response) => {
  try {
    const societeId = req.utilisateur!.societeId;

    const documents = await prisma.documentVentes.findMany({
      where: { societeId },
      select: { id: true, periodeDebut: true, importeLe: true },
    });
    // Ordonnées chronologiquement par la date la plus significative disponible : la période
    // déclarée par l'utilisateur si elle existe, sinon la date d'import réelle du document.
    const documentsTries = [...documents].sort(
      (a, b) => (a.periodeDebut ?? a.importeLe).getTime() - (b.periodeDebut ?? b.importeLe).getTime()
    );
    const indexPeriodeParDocument = new Map(documentsTries.map((d, index) => [d.id, index]));
    const nbPeriodes = documentsTries.length;

    if (nbPeriodes < 2) {
      res.json({ nbPeriodes, items: [], previsionQuantiteTotale: 0, previsionCaTotale: null });
      return;
    }

    const lignesValidees = await prisma.ligneVente.findMany({
      where: { decision: "VALIDEE", recetteRetenueId: { not: null }, documentVentes: { societeId } },
      select: { recetteRetenueId: true, quantiteVendue: true, documentVentesId: true },
    });

    // quantiteParPeriode[recetteId] est un tableau de longueur nbPeriodes, indexé chronologiquement
    // (0 = ancienne, aucune vente sur une période -> 0, jamais une période absente du tableau : sans
    // ça, une recette introduite récemment paraîtrait avoir une tendance erratique).
    const quantiteParPeriode = new Map<number, number[]>();
    for (const ligne of lignesValidees) {
      const recetteId = ligne.recetteRetenueId!;
      const indexPeriode = indexPeriodeParDocument.get(ligne.documentVentesId);
      if (indexPeriode === undefined) continue;
      const tableau = quantiteParPeriode.get(recetteId) ?? new Array(nbPeriodes).fill(0);
      tableau[indexPeriode] += ligne.quantiteVendue;
      quantiteParPeriode.set(recetteId, tableau);
    }

    const recettes = await prisma.recette.findMany({
      where: { id: { in: [...quantiteParPeriode.keys()] } },
      include: inclusionsRecette,
    });
    const recettesAvecCout = calculerCoutsRecettesSansErreur(recettes);
    const recetteParId = new Map(recettesAvecCout.map((r) => [r.id, r]));

    const items = [...quantiteParPeriode.entries()].map(([recetteId, quantites]) => {
      const nbDernieresPeriodes = Math.min(3, quantites.length);
      const dernieres = quantites.slice(-nbDernieresPeriodes);
      const previsionProchainePeriode = dernieres.reduce((total, q) => total + q, 0) / nbDernieresPeriodes;

      const derniere = quantites[quantites.length - 1];
      const precedentes = quantites.slice(0, -1);
      const moyennePrecedentes = precedentes.reduce((total, q) => total + q, 0) / precedentes.length;
      let tendance: TendancePrevision = "stable";
      if (moyennePrecedentes > 0) {
        const variationPct = ((derniere - moyennePrecedentes) / moyennePrecedentes) * 100;
        if (variationPct >= SEUIL_TENDANCE_PCT) tendance = "hausse";
        else if (variationPct <= -SEUIL_TENDANCE_PCT) tendance = "baisse";
      } else if (derniere > 0) {
        tendance = "hausse";
      }

      const recette = recetteParId.get(recetteId);
      const prixVenteHT = recette?.prixVenteHT ?? null;
      const caEstimeProchainePeriode = prixVenteHT != null ? previsionProchainePeriode * prixVenteHT : null;

      return {
        recetteId,
        recetteNom: recette?.nom ?? null,
        historique: quantites,
        previsionProchainePeriode,
        tendance,
        prixVenteHT,
        caEstimeProchainePeriode,
      };
    });

    const previsionQuantiteTotale = items.reduce((total, item) => total + item.previsionProchainePeriode, 0);
    // Somme partielle assumée (recettes sans prix de vente simplement exclues) : contrairement à
    // /reconciliation, il n'y a pas ici de risque de mélanger un prix réel et un prix théorique —
    // seulement le prix de vente actuel, donc une somme partielle reste une estimation honnête.
    const recettesAvecPrix = items.filter((item) => item.caEstimeProchainePeriode != null);
    const previsionCaTotale =
      recettesAvecPrix.length > 0
        ? recettesAvecPrix.reduce((total, item) => total + (item.caEstimeProchainePeriode ?? 0), 0)
        : null;

    res.json({ nbPeriodes, items, previsionQuantiteTotale, previsionCaTotale });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de calculer les prévisions de ventes" });
  }
});

export default router;
