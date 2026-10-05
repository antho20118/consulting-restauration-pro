import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { calculerCoutRecette, calculerCoutsRecettesSansErreur, inclusionsRecette } from "../utils/coutRecette.js";
import { suggestionsEconomieRecette } from "../utils/suggestionsEconomie.js";
import { extraireRecette, ImportIANonConfigureError, PhotoInvalideError } from "../utils/importRecetteIA.js";
import { genererFicheRecettePdf } from "../utils/pdf/ficheRecettePdf.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// Validation minimale de la création/modification d'une recette (voir caractérisation dédiée) :
// seuls les champs dont l'absence de contrôle a un effet réel démontré sont validés ici — nom
// vide/trop long, prixVenteHT négatif (corrompt margeHT/foodCostPct, consommés par
// server/routes/consulting.ts et server/routes/dashboard.ts). Les autres champs (categorieId,
// sousCategorieId, societeId, portions, poidsPortionG, lignes vides, articleId/quantite/uniteId de
// ligne) restent volontairement hors de ce lot : portions et ligne.quantite sont déjà protégés par
// calculerCoutRecette/versUniteBase (transaction intégralement annulée en cas d'invalidité), les
// FK par Postgres, et aucun impact aval dangereux n'a été démontré pour poidsPortionG ni pour une
// recette sans ingrédient. Même style que les schémas déjà en place ailleurs (voir
// server/routes/articles.ts). POST et PUT partagent exactement le même sous-ensemble de champs
// validés ici (contrairement à articles.ts, où `type` diffère entre création et modification).
const champsRecette = {
  nom: z
    .string()
    .trim()
    .min(1, "Le nom est obligatoire")
    .max(200, "Le nom est trop long (200 caractères maximum)"),
  prixVenteHT: z.number().finite().min(0, "Le prix de vente HT ne peut pas être négatif").nullable().optional(),
};
const schemaRecette = z.object(champsRecette);

// gainCuissonPct représente un GAIN de poids à la cuisson (eau/sauce absorbée par l'ingrédient),
// jamais une perte : la perte est déjà intégralement portée par Article.rendement (voir le
// commentaire du champ RecetteLigne.gainCuissonPct dans prisma/schema.prisma). Une valeur négative
// n'a donc pas de sens métier et peut produire un poidsFiniTotalG négatif, persisté tel quel (voir
// coutRecette.ts::calculerCoutRecette). Aucune borne supérieure n'est en revanche déductible du
// modèle actuel : un gain de poids à la cuisson peut légitimement dépasser 100 % pour certains
// ingrédients (riz, légumineuses...) — volontairement non bornée au-delà de .finite().
const schemaGainCuissonPct = z
  .number()
  .finite()
  .min(0, "Le gain à la cuisson ne peut pas être négatif")
  .optional();

// Liste des recettes
router.get("/", async (req: Request, res: Response) => {
  try {
    const recettes = await prisma.recette.findMany({
      where: { actif: true, societeId: req.utilisateur!.societeId },
      include: inclusionsRecette,
      orderBy: { nom: "asc" },
    });

    res.json(calculerCoutsRecettesSansErreur(recettes));
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer les recettes" });
  }
});

// Toutes les recettes, actives ET inactives, pour la correspondance de l'import Excel sécurisé
// (voir correspondanceImportExcel.ts) : contrairement à GET / ci-dessus (recettes actives
// uniquement, avec coûts calculés), une recette inactive doit pouvoir être reconnue et mise à
// jour par cet import sans jamais être réactivée automatiquement — juste le strict nécessaire
// (id/nom/actif) pour la correspondance, jamais les coûts ou le détail complet.
// Doit rester déclarée AVANT GET /:id pour ne pas être interceptée par cette route générique.
router.get("/toutes-pour-correspondance", async (req: Request, res: Response) => {
  try {
    const recettes = await prisma.recette.findMany({
      where: { societeId: req.utilisateur!.societeId },
      select: { id: true, nom: true, actif: true },
      orderBy: { nom: "asc" },
    });

    res.json(recettes);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer les recettes" });
  }
});

// Détail d'une recette
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    // Scopé par société : jamais permettre de deviner/énumérer une recette d'une autre société en
    // devinant simplement un id (voir la matrice de permissions, server/app.ts).
    const recette = await prisma.recette.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
      include: inclusionsRecette,
    });

    if (!recette) {
      res.status(404).json({ error: "Recette introuvable" });
      return;
    }

    res.json(calculerCoutRecette(recette));
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer la recette" });
  }
});

// Fiche technique en PDF téléchargeable — même donnée que GET /:id (calculerCoutRecette), mise en
// forme par server/utils/pdf/ficheRecettePdf.tsx plutôt que recalculée ici.
router.get("/:id/export-pdf", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const recette = await prisma.recette.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
      include: inclusionsRecette,
    });

    if (!recette) {
      res.status(404).json({ error: "Recette introuvable" });
      return;
    }

    const calculee = calculerCoutRecette(recette);
    // Reconstruit explicitement la forme attendue par genererFicheRecettePdf (RecetteFichePdf) —
    // calculerCoutRecette étant générique, son type de retour exact dépend de l'instanciation de
    // son paramètre générique T et ne se laisse pas nommer proprement depuis un autre fichier ;
    // plus simple et plus sûr de retyper ici, au point d'appel, où le type concret est connu.
    const pdf = await genererFicheRecettePdf({
      nom: calculee.nom,
      categorie: calculee.categorie,
      sousCategorie: calculee.sousCategorie,
      portions: calculee.portions,
      instructions: calculee.instructions,
      allergenes: calculee.allergenes,
      nutritionIncomplete: calculee.nutritionIncomplete,
      valeursNutritionnelles: calculee.valeursNutritionnelles,
      lignes: calculee.lignes.map((ligne) => ({
        id: ligne.id,
        quantite: ligne.quantite,
        unite: { symbole: ligne.unite.symbole },
        article: { nom: ligne.article.nom },
        coutLigne: ligne.coutLigne,
      })),
      etapes: calculee.etapes,
      coutParPortion: calculee.coutParPortion,
      prixVenteHT: calculee.prixVenteHT,
      foodCostPct: calculee.foodCostPct,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="fiche-${recette.nom.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf"`
    );
    res.send(pdf);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de générer la fiche PDF" });
  }
});

// Suggestions d'économies : tarifs fournisseurs moins chers pour un même article déjà utilisé
// dans la recette (jamais un remplacement d'un article par un autre — voir
// server/utils/suggestionsEconomie.ts).
router.get("/:id/suggestions-economie", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const suggestions = await suggestionsEconomieRecette(id, req.utilisateur!.societeId);

    res.json(suggestions);
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de calculer les suggestions d'économies" });
  }
});

// Taille maximale d'une photo acceptée pour l'import IA (décodée, avant l'encodage base64 qui la
// gonfle d'environ 33 %) : une photo de fiche technique lisible n'a jamais besoin de dépasser cette
// taille (voir redimensionnerImage.ts côté client, qui la réduit systématiquement bien en-deçà) —
// au-delà, il s'agit soit d'une erreur d'intégration cliente, soit d'un usage anormal de l'API,
// jamais d'un cas légitime. Fixée nettement en-dessous de la limite générique du corps JSON
// (express.json({limit:"10mb"}), server/app.ts) une fois ré-encodée en base64 (+33 %) : sinon cette
// limite globale, moins explicite pour l'appelant (413 générique), interviendrait en premier et
// rendrait cette vérification dédiée inatteignable pour les cas qu'elle doit précisément couvrir.
export const TAILLE_MAX_PHOTO_OCTETS = 6 * 1024 * 1024;

// L'appel à l'IA est une requête réseau vers un service tiers : sans limite, une requête qui ne
// répond jamais laisserait le client indéfiniment sur un état "Analyse en cours…" sans queue moyen
// de s'en sortir autrement qu'en fermant l'onglet. Le délai reste large (l'analyse d'une photo
// dense en texte peut prendre plusieurs dizaines de secondes) mais borné.
const DELAI_MAX_ANALYSE_MS = 60_000;

export class AnalyseTimeoutError extends Error {}

export function tailleDecodeeBase64Octets(donneesBase64: string): number {
  const paddingCount = donneesBase64.endsWith("==") ? 2 : donneesBase64.endsWith("=") ? 1 : 0;
  return Math.floor((donneesBase64.length * 3) / 4) - paddingCount;
}

export async function avecTimeout<T>(promesse: Promise<T>, delaiMs: number): Promise<T> {
  let identifiantTimer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    identifiantTimer = setTimeout(() => reject(new AnalyseTimeoutError("Délai d'analyse dépassé")), delaiMs);
  });
  try {
    return await Promise.race([promesse, timeout]);
  } finally {
    clearTimeout(identifiantTimer!);
  }
}

// Import d'une recette depuis un texte libre ou une photo (IA) : extrait, en une seule analyse
// structurée, nom, catégorie/sous-catégorie détectées, portions, poids, ingrédients, étapes
// classées préparation/cuisson/dressage/autre, matériel, notes et alertes. Ne crée rien en base ni
// ne rapproche les ingrédients/matériel des articles existants (voir server/utils/importRecetteIA.ts)
// — c'est une extraction que l'utilisateur revoit dans la prévisualisation globale puis valide dans
// le formulaire de recette habituel avant d'enregistrer.
router.post("/import-ia", async (req: Request, res: Response) => {
  try {
    const { texte, photoDataUrl } = req.body as { texte?: string; photoDataUrl?: string };

    if (!texte?.trim() && !photoDataUrl) {
      res.status(400).json({ error: "Texte ou photo de recette requis" });
      return;
    }

    if (photoDataUrl) {
      const correspondance = /^data:image\/[a-zA-Z+]+;base64,(.+)$/.exec(photoDataUrl);
      if (!correspondance) {
        res.status(400).json({ error: "Format de photo invalide" });
        return;
      }
      if (tailleDecodeeBase64Octets(correspondance[1]) > TAILLE_MAX_PHOTO_OCTETS) {
        res.status(400).json({ error: "Photo trop volumineuse (6 Mo maximum)" });
        return;
      }
    }

    // Mêmes listes, non filtrées sur actif, que celles proposées par le formulaire de recette
    // (voir GET /categories-recette, /sous-categories-recette) : la catégorie détectée doit
    // toujours pouvoir être choisie parmi les options réellement proposées à l'utilisateur.
    const [unites, categories, sousCategories] = await Promise.all([
      prisma.unite.findMany({ where: { actif: true } }),
      prisma.categorieRecette.findMany(),
      prisma.sousCategorieRecette.findMany(),
    ]);
    const extraction = await avecTimeout(
      extraireRecette(
        texte?.trim() ? { texte } : { photoDataUrl: photoDataUrl! },
        unites.map((u) => u.symbole),
        categories.map((c) => c.nom),
        sousCategories.map((sc) => sc.nom)
      ),
      DELAI_MAX_ANALYSE_MS
    );

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
    if (error instanceof AnalyseTimeoutError) {
      res.status(504).json({ error: "L'analyse a pris trop de temps. Réessaie avec une photo plus simple." });
      return;
    }
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible d'analyser cette recette" });
  }
});

// Décision d'import validée par l'utilisateur dans l'aperçu de l'import Excel sécurisé (voir
// ImporterRecettesExcelSecuriseModal.tsx) : soit la création d'une recette entièrement nouvelle
// (aucune correspondance trouvée), soit la mise à jour des ingrédients d'une recette existante
// déjà reconnue avec certitude (une seule correspondance, jamais choisie automatiquement en cas
// d'ambiguïté — cette décision est prise côté client avant l'appel).
type DecisionImportExcel =
  | {
      action: "creer";
      nom: string;
      categorieId: number | null;
      sousCategorieId: number | null;
      lignes: { articleId: number; quantite: number; uniteId: number; gainCuissonPct?: number }[];
    }
  | {
      action: "mettre_a_jour";
      recetteId: number;
      lignes: { articleId: number; quantite: number; uniteId: number; gainCuissonPct?: number }[];
    };

// Import Excel sécurisé (ingrédients/quantités/coûts uniquement, jamais la technique) : reçoit la
// liste des décisions déjà validées dans l'aperçu (voir ImporterRecettesExcelSecuriseModal.tsx) et
// les applique TOUTES dans une seule transaction Prisma — si l'une échoue, aucune des autres n'est
// conservée (voir le commentaire d'atomicité ci-dessous), jamais un lot partiellement écrit.
//
// RÈGLE ABSOLUE pour "mettre_a_jour" : contrairement à PUT /:id (qui remplace intégralement
// lignes ET étapes, voir son commentaire plus bas), cette route ne touche JAMAIS RecetteEtape ni
// aucun autre champ de la recette (nom, instructions, photo, categorieId, sousCategorieId,
// portions, poidsPortionG, poidsAccompagnementG, prixVenteHT, actif) — seule sa table
// RecetteLigne est remplacée. Une recette inactive reconnue par ce chemin reste inactive : ce
// champ n'apparaît nulle part dans cette route, il ne peut donc pas être modifié par erreur.
// Signal interne utilisé uniquement pour annuler volontairement la transaction en mode aperçu
// (simulate: true) : porte les résultats déjà calculés jusqu'au bloc catch, sans qu'aucune des
// écritures de cette transaction ne soit jamais conservée en base (rollback Prisma standard).
class SimulationApercuAnnulee extends Error {
  constructor(public resultats: unknown[]) {
    super("Aperçu de coût : transaction volontairement annulée, aucune écriture conservée");
  }
}

router.post("/import-excel", async (req: Request, res: Response) => {
  try {
    const { decisions, simulate } = req.body as {
      decisions: DecisionImportExcel[];
      // Calcule le coût résultant de chaque décision via le même calculerCoutRecette que l'import
      // réel (aucune deuxième formule), en écrivant réellement dans la transaction puis en
      // l'annulant systématiquement avant de la valider — jamais une estimation approximative
      // recalculée séparément, jamais une écriture conservée en base.
      simulate?: boolean;
    };

    if (!Array.isArray(decisions) || decisions.length === 0) {
      res.status(400).json({ error: "Aucune décision d'import fournie" });
      return;
    }

    // Garde-fou explicite et bloquant (cas réel identifié à l'audit : "SAUTE DE VEAU MARENGO" et
    // "SAUTE DE VEAU AUX OLIVES" correspondent chacune, individuellement, à l'unique recette
    // existante "Saute de veau") : si deux décisions "mettre_a_jour" du même lot visaient la même
    // recette, la seconde écraserait silencieusement le résultat de la première (deleteMany, puis
    // recreate, exécutés en séquence) sans qu'aucune erreur ne soit jamais levée. Détecté et
    // rejeté ici, AVANT toute écriture — jamais résolu silencieusement après coup côté serveur ;
    // c'est à l'aperçu (ImporterRecettesExcelSecuriseModal.tsx) d'empêcher cette situation
    // d'atteindre cette route en premier lieu.
    const cibles = new Map<number, number>();
    for (const decision of decisions) {
      if (decision.action !== "mettre_a_jour") continue;
      cibles.set(decision.recetteId, (cibles.get(decision.recetteId) ?? 0) + 1);
    }
    const recetteIdEnConflit = [...cibles.entries()].find(([, count]) => count > 1)?.[0];
    if (recetteIdEnConflit !== undefined) {
      res.status(400).json({
        error: `Conflit d'import : plusieurs décisions de ce lot visent la même recette (id ${recetteIdEnConflit}) — aucune écriture effectuée.`,
      });
      return;
    }

    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma).
    const societeId = req.utilisateur!.societeId;

    const resultats = await prisma.$transaction(async (tx) => {
      const sortie: { action: DecisionImportExcel["action"]; recette: ReturnType<typeof calculerCoutRecette> }[] = [];

      // Revérifié à CET instant (même principe que POST/PUT /recettes, F03) : la décision "creer"
      // a été prise côté client à l'aperçu (ImporterRecettesExcelSecuriseModal.tsx), sur la base
      // des recettes existantes à ce moment-là — sans ce contrôle, une recette créée par un AUTRE
      // import concurrent entre l'aperçu et cet appel serait dupliquée silencieusement. Chargé une
      // seule fois (jamais une requête par décision) ; complété au fur et à mesure avec les noms
      // déjà créés dans CE lot, pour couvrir aussi le cas où deux décisions "creer" du même lot
      // portent le même nom — comparaison trim + insensible à la casse, comme POST/PUT /recettes.
      const nomsExistants = new Set(
        (await tx.recette.findMany({ where: { actif: true, societeId }, select: { nom: true } })).map((r) =>
          r.nom.trim().toLowerCase()
        )
      );

      for (const decision of decisions) {
        if (decision.action === "creer") {
          const nomTrim = decision.nom.trim();
          const nomCle = nomTrim.toLowerCase();
          if (nomsExistants.has(nomCle)) {
            throw new Error(`Conflit d'import : une recette nommée "${nomTrim}" existe déjà — aucune écriture effectuée.`);
          }
          nomsExistants.add(nomCle);

          const creee = await tx.recette.create({
            data: {
              nom: decision.nom,
              categorieId: decision.categorieId ?? null,
              sousCategorieId: decision.sousCategorieId ?? null,
              societeId,
              lignes: {
                create: decision.lignes.map((ligne, index) => ({
                  articleId: ligne.articleId,
                  quantite: ligne.quantite,
                  uniteId: ligne.uniteId,
                  gainCuissonPct: ligne.gainCuissonPct ?? 0,
                  ordre: index,
                })),
              },
              // etapes volontairement absent de ce payload : une recette créée par cet import n'a
              // par nature aucune technique de réalisation existante à préserver.
            },
            include: inclusionsRecette,
          });
          sortie.push({ action: "creer", recette: calculerCoutRecette(creee) });
        } else {
          // Scopé par société : jamais permettre à cet import de mettre à jour une recette d'une
          // autre société en devinant simplement un id.
          const existante = await tx.recette.findFirst({ where: { id: decision.recetteId, societeId } });
          if (!existante) {
            // Lève dans la transaction : Prisma annule automatiquement tout ce qui a déjà été fait
            // dans ce même $transaction (créations et mises à jour précédentes de ce lot incluses).
            throw new Error(`Recette ${decision.recetteId} introuvable pour la mise à jour`);
          }

          await tx.recetteLigne.deleteMany({ where: { recetteId: decision.recetteId } });
          await tx.recetteLigne.createMany({
            data: decision.lignes.map((ligne, index) => ({
              recetteId: decision.recetteId,
              articleId: ligne.articleId,
              quantite: ligne.quantite,
              uniteId: ligne.uniteId,
              gainCuissonPct: ligne.gainCuissonPct ?? 0,
              ordre: index,
            })),
          });

          const miseAJour = await tx.recette.findUniqueOrThrow({
            where: { id: decision.recetteId },
            include: inclusionsRecette,
          });
          sortie.push({ action: "mettre_a_jour", recette: calculerCoutRecette(miseAJour) });
        }
      }

      if (simulate) throw new SimulationApercuAnnulee(sortie);
      return sortie;
    });

    res.status(200).json({ simulate: false, resultats });
  } catch (error) {
    if (error instanceof SimulationApercuAnnulee) {
      // Transaction annulée volontairement (voir plus haut) : la requête a bien atteint la base
      // pour calculer un coût réel via calculerCoutRecette, mais rien n'a été conservé.
      res.status(200).json({ simulate: true, resultats: error.resultats });
      return;
    }
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de finaliser l'import (aucune modification conservée)" });
  }
});

// Création d'une recette
router.post("/", async (req: Request, res: Response) => {
  try {
    const analyse = schemaRecette.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Recette invalide", details: analyse.error.flatten() });
      return;
    }
    const { nom, prixVenteHT } = analyse.data;
    const {
      categorieId,
      sousCategorieId,
      portions,
      instructions,
      photo,
      poidsPortionG,
      poidsAccompagnementG,
      lignes,
      etapes,
    } = req.body as {
      categorieId?: number | null;
      sousCategorieId?: number | null;
      portions?: number;
      instructions?: string | null;
      photo?: string | null;
      poidsPortionG?: number | null;
      poidsAccompagnementG?: number | null;
      lignes: { articleId: number; quantite: number; uniteId: number; gainCuissonPct?: number }[];
      etapes?: { description: string; pointCritiqueHACCP: boolean; controleHACCP: string | null }[];
    };

    // Chaque gainCuissonPct de ligne est validé indépendamment de la structure lignes elle-même
    // (articleId/quantite/uniteId restent hors périmètre de cette validation, voir caractérisation
    // dédiée et le commentaire de schemaGainCuissonPct plus haut).
    if (Array.isArray(lignes)) {
      for (const ligne of lignes) {
        const analyseLigne = schemaGainCuissonPct.safeParse(ligne?.gainCuissonPct);
        if (!analyseLigne.success) {
          res.status(400).json({ error: "Recette invalide", details: analyseLigne.error.flatten() });
          return;
        }
      }
    }

    // calculerCoutRecette valide au passage les données de la recette (portions > 0, rendement de
    // chaque article, etc.) et lève une exception sinon — elle doit donc être appelée DANS la même
    // transaction que l'écriture, pour que Prisma annule automatiquement la création si elle
    // échoue. Avant ce correctif, l'appel avait lieu après la création : une recette invalide (ex.
    // portions=0) était bel et bien enregistrée en base malgré la réponse 500 renvoyée au client
    // (voir l'audit de l'agent Consulting, qui a découvert ce cas en la rendant impossible à
    // analyser par la suite).
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma).
    const societeId = req.utilisateur!.societeId;

    // Aucune contrainte `@@unique` sur Recette.nom (homonymie parfois légitime, ex. "Sauce
    // tomate" dans deux catégories) : le rapprochement existait déjà côté client (RecetteForm.tsx,
    // ImporterRecettesExcelSecuriseModal.tsx) mais jamais revérifié ici — une requête API directe,
    // ou simplement deux onglets ouverts en parallèle, créait un doublon silencieux malgré
    // l'avertissement affiché (voir audit du 2026-10-01, F03). Recalculé à CET instant (jamais une
    // liste transmise par le client), scopé par société, actif uniquement (une recette désactivée
    // ne bloque jamais une nouvelle création du même nom). confirmerDoublon (booléen, pas un id
    // précis comme pour les articles) : plusieurs recettes homonymes actives restent possibles
    // (aucune contrainte d'unicité, homonymie parfois légitime) — la confirmation porte donc sur
    // « je sais, crée quand même », jamais sur UN candidat précis parmi d'éventuels doublons.
    const nomTrim = nom.trim();
    const confirmerDoublon = req.body.confirmerDoublon === true;
    const candidatsMemeNom = await prisma.recette.findMany({
      where: { actif: true, societeId },
      select: { id: true, nom: true },
    });
    const doublonsNom = candidatsMemeNom.filter((r) => r.nom.trim().toLowerCase() === nomTrim.toLowerCase());
    if (doublonsNom.length > 0 && !confirmerDoublon) {
      res.status(409).json({
        error: "Une recette portant ce nom existe déjà",
        doublons: doublonsNom.map((d) => ({ id: d.id, nom: d.nom })),
      });
      return;
    }

    const recette = await prisma.$transaction(async (tx) => {
      const creee = await tx.recette.create({
        data: {
          nom,
          categorieId: categorieId ?? null,
          sousCategorieId: sousCategorieId ?? null,
          societeId,
          portions: portions ?? 1,
          prixVenteHT: prixVenteHT ?? null,
          instructions: instructions ?? null,
          photo: photo ?? null,
          poidsPortionG: poidsPortionG ?? null,
          poidsAccompagnementG: poidsAccompagnementG ?? null,
          lignes: {
            create: (lignes ?? []).map((ligne, index) => ({
              articleId: ligne.articleId,
              quantite: ligne.quantite,
              uniteId: ligne.uniteId,
              gainCuissonPct: ligne.gainCuissonPct ?? 0,
              ordre: index,
            })),
          },
          etapes: {
            create: (etapes ?? []).map((etape, index) => ({
              description: etape.description,
              pointCritiqueHACCP: etape.pointCritiqueHACCP,
              controleHACCP: etape.controleHACCP,
              ordre: index,
            })),
          },
        },
        include: inclusionsRecette,
      });

      return calculerCoutRecette(creee);
    });

    res.status(201).json(recette);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de créer la recette", req);
  }
});

// Mise à jour d'une recette (les lignes et les étapes sont remplacées intégralement)
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const analyse = schemaRecette.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Recette invalide", details: analyse.error.flatten() });
      return;
    }
    const { nom, prixVenteHT } = analyse.data;
    const {
      categorieId,
      sousCategorieId,
      portions,
      instructions,
      photo,
      poidsPortionG,
      poidsAccompagnementG,
      lignes,
      etapes,
    } = req.body as {
      categorieId?: number | null;
      sousCategorieId?: number | null;
      portions?: number;
      instructions?: string | null;
      photo?: string | null;
      poidsPortionG?: number | null;
      poidsAccompagnementG?: number | null;
      lignes: { articleId: number; quantite: number; uniteId: number; gainCuissonPct?: number }[];
      etapes?: { description: string; pointCritiqueHACCP: boolean; controleHACCP: string | null }[];
    };

    // Chaque gainCuissonPct de ligne est validé indépendamment (voir POST /recettes ci-dessus pour
    // la justification détaillée).
    if (Array.isArray(lignes)) {
      for (const ligne of lignes) {
        const analyseLigne = schemaGainCuissonPct.safeParse(ligne?.gainCuissonPct);
        if (!analyseLigne.success) {
          res.status(400).json({ error: "Recette invalide", details: analyseLigne.error.flatten() });
          return;
        }
      }
    }

    // Jamais depuis req.body (même principe que POST ci-dessus).
    const societeId = req.utilisateur!.societeId;

    // Même correctif F03 qu'à la création, pour le renommage : exclut explicitement la recette
    // elle-même (id: { not: id }), pour qu'enregistrer une recette SANS changer son nom (ou en ne
    // changeant que la casse/les espaces) ne se bloque jamais sur sa propre ligne — seul un
    // renommage qui entre en collision avec une AUTRE recette active de la société est concerné.
    const nomTrim = nom.trim();
    const confirmerDoublon = req.body.confirmerDoublon === true;
    const candidatsMemeNom = await prisma.recette.findMany({
      where: { actif: true, societeId, id: { not: id } },
      select: { id: true, nom: true },
    });
    const doublonsNom = candidatsMemeNom.filter((r) => r.nom.trim().toLowerCase() === nomTrim.toLowerCase());
    if (doublonsNom.length > 0 && !confirmerDoublon) {
      res.status(409).json({
        error: "Une recette portant ce nom existe déjà",
        doublons: doublonsNom.map((d) => ({ id: d.id, nom: d.nom })),
      });
      return;
    }

    // calculerCoutRecette (qui valide au passage portions > 0, le rendement de chaque article,
    // etc.) doit être appelée DANS cette même transaction, pour que Prisma annule aussi le
    // remplacement des lignes/étapes déjà effectué si elle échoue — même correctif et même raison
    // que pour la création ci-dessus (voir son commentaire).
    const recette = await prisma.$transaction(async (tx) => {
      // Scopé par société : jamais permettre à un compte de modifier une recette d'une autre
      // société en devinant/énumérant simplement un id (voir la matrice de permissions,
      // server/app.ts).
      await tx.recette.findFirstOrThrow({ where: { id, societeId } });

      await tx.recetteLigne.deleteMany({ where: { recetteId: id } });
      await tx.recetteEtape.deleteMany({ where: { recetteId: id } });

      const miseAJour = await tx.recette.update({
        where: { id },
        data: {
          nom,
          categorieId: categorieId ?? null,
          sousCategorieId: sousCategorieId ?? null,
          portions: portions ?? 1,
          prixVenteHT: prixVenteHT ?? null,
          instructions: instructions ?? null,
          photo: photo ?? null,
          poidsPortionG: poidsPortionG ?? null,
          poidsAccompagnementG: poidsAccompagnementG ?? null,
          lignes: {
            create: (lignes ?? []).map((ligne, index) => ({
              articleId: ligne.articleId,
              quantite: ligne.quantite,
              uniteId: ligne.uniteId,
              gainCuissonPct: ligne.gainCuissonPct ?? 0,
              ordre: index,
            })),
          },
          etapes: {
            create: (etapes ?? []).map((etape, index) => ({
              description: etape.description,
              pointCritiqueHACCP: etape.pointCritiqueHACCP,
              controleHACCP: etape.controleHACCP,
              ordre: index,
            })),
          },
        },
        include: inclusionsRecette,
      });

      return calculerCoutRecette(miseAJour);
    });

    res.json(recette);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de mettre à jour la recette", req);
  }
});

// Suppression (douce) de toutes les recettes actives : même principe que la suppression
// individuelle ci-dessous (actif: false, rien n'est effacé), pour repartir d'une liste vide sans
// perdre irréversiblement les données en cas d'erreur.
router.delete("/", async (req: Request, res: Response) => {
  try {
    const { count } = await prisma.recette.updateMany({
      where: { actif: true, societeId: req.utilisateur!.societeId },
      data: { actif: false },
    });

    res.json({ supprimees: count });
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer les recettes" });
  }
});

// Suppression (douce) d'une recette
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const { count } = await prisma.recette.updateMany({
      where: { id, societeId: req.utilisateur!.societeId },
      data: { actif: false },
    });
    if (count === 0) {
      res.status(404).json({ error: "Recette introuvable" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer la recette" });
  }
});

export default router;
