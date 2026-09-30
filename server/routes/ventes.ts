import { Router } from "express";
import type { Request, Response } from "express";

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

export default router;
