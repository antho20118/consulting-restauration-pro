import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import prisma from "../prisma.js";
import { calculerCoutMenu, calculerCoutsMenusSansErreur, inclusionsMenu } from "../utils/coutMenu.js";
import { repondreErreurEcriture } from "../utils/erreursEcriture.js";
import { journaliserErreur, contexteDepuisRequete } from "../utils/journalErreurs.js";

const router = Router();

// Bornes réelles du stockage Postgres (INT4, même constat que server/routes/articles.ts::
// ID_POSTGRES_MIN/MAX) : un categorieId/recetteId ou un id d'URL numériquement valide mais hors de
// cette plage atteint directement le driver Postgres (ConnectorError), jamais classé P2003/P2025
// par repondreErreurEcriture, donc un 500 — confirmé empiriquement (2147483648 et
// 9007199254740991) sur categorieId, recetteId et l'id d'URL de PUT /:id. Dupliqué ici plutôt
// qu'importé : ID_POSTGRES_MIN/MAX n'est pas exporté par articles.ts, et ce chantier reste
// strictement limité à server/routes/menus.ts (voir périmètre).
const ID_POSTGRES_MIN = -2147483648;
const ID_POSTGRES_MAX = 2147483647;

// Validation minimale de POST/PUT /api/menus (voir rapport RED dédié) : seuls les champs dont
// l'absence de contrôle de TYPE a un effet réel démontré (PrismaClientValidationError ou
// ConnectorError Postgres, jamais interceptés par repondreErreurEcriture) sont validés ici. Aucune
// règle métier non démontrée n'est ajoutée : prixVenteHT négatif et quantite = 0 (une valeur
// numérique valide) restent acceptés exactement comme avant ce correctif (aucun crash constaté
// pour ces valeurs), seul leur TYPE est désormais vérifié. nom n'est pas trim()é ni borné en
// longueur : aucun de ces comportements n'était contrôlé avant, et aucun crash ne leur est associé.
// quantite: null (explicite, distinct de 0 et de l'omission) crashait déjà avant ce correctif
// (PrismaClientValidationError sur MenuLigne.quantite, colonne Float non nullable) — ce correctif
// le transforme en 400 propre, comme tout autre type invalide.
const champsMenu = {
  nom: z.string(),
  description: z.string().nullable().optional(),
  categorieId: z.number().int().gte(ID_POSTGRES_MIN).lte(ID_POSTGRES_MAX).nullable().optional(),
  prixVenteHT: z.number().finite().nullable().optional(),
  // quantite reste optionnelle : omise, la colonne MenuLigne.quantite applique son défaut Prisma
  // (1), comportement historique préservé à l'identique (voir prisma/schema.prisma).
  lignes: z
    .array(
      z.object({
        recetteId: z.number().int().gte(ID_POSTGRES_MIN).lte(ID_POSTGRES_MAX),
        quantite: z.number().finite().optional(),
      })
    )
    // null accepté et traité comme [] (voir (lignes ?? []) dans les deux handlers) : déjà le
    // comportement réel avant ce correctif (confirmé empiriquement sur la base non modifiée,
    // POST et PUT), jamais un refus.
    .nullable()
    .optional(),
};
// Création : nom obligatoire, comme aujourd'hui (son absence provoque déjà une
// PrismaClientValidationError côté création — aucun appelant existant ne l'omet).
const schemaCreationMenu = z.object(champsMenu);
// Modification : nom optionnel — confirmé empiriquement sur la base non modifiée que son omission
// ne touche pas la colonne (Prisma ignore une clé `undefined` dans `data`, contrairement à
// description/categorieId/prixVenteHT, qui utilisent `?? null` et sont donc bien remis à null à
// l'omission) : PUT remplace intégralement lignes et les autres champs, mais préserve nom s'il est
// omis — comportement réel préexistant, jamais une symétrisation artificielle avec POST.
const schemaModificationMenu = z.object(champsMenu).partial({ nom: true });

// Cloisonnement multi-société (faille confirmée : un recetteId d'une autre société pouvait être
// injecté dans un menu sans aucune vérification, contrairement à categorieId juste au-dessus dans
// les mêmes handlers — GET /:id réexposait ensuite nom/coût/allergènes/nutrition de la recette
// étrangère via inclusionsMenu). Vérification groupée (une seule requête, jamais une par ligne) ;
// ne distingue jamais "recetteId inexistant" de "recetteId d'une autre société" dans la réponse.
async function recettesAppartiennentALaSociete(recetteIds: number[], societeId: number): Promise<boolean> {
  if (recetteIds.length === 0) return true;
  const recettesValides = await prisma.recette.findMany({
    where: { id: { in: recetteIds }, societeId },
    select: { id: true },
  });
  return recettesValides.length === recetteIds.length;
}

// Liste des menus
router.get("/", async (req: Request, res: Response) => {
  try {
    const menus = await prisma.menu.findMany({
      where: { actif: true, societeId: req.utilisateur!.societeId },
      include: inclusionsMenu,
      orderBy: { nom: "asc" },
    });

    res.json(calculerCoutsMenusSansErreur(menus));
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer les menus" });
  }
});

// Détail d'un menu
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    // Scopé par société : jamais permettre de deviner/énumérer un menu d'une autre société en
    // devinant simplement un id (voir la matrice de permissions, server/app.ts).
    const menu = await prisma.menu.findFirst({
      where: { id, societeId: req.utilisateur!.societeId },
      include: inclusionsMenu,
    });

    if (!menu) {
      res.status(404).json({ error: "Menu introuvable" });
      return;
    }

    res.json(calculerCoutMenu(menu));
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de récupérer le menu" });
  }
});

// Création d'un menu
router.post("/", async (req: Request, res: Response) => {
  try {
    const analyse = schemaCreationMenu.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Menu invalide", details: analyse.error.flatten() });
      return;
    }
    const { nom, description, categorieId, prixVenteHT, lignes } = analyse.data;
    // Jamais depuis req.body : la société d'écriture est celle du compte connecté, jamais une
    // valeur transmise par le client (voir Utilisateur/RoleUtilisateur, prisma/schema.prisma).
    const societeId = req.utilisateur!.societeId;

    // CategorieRecette est désormais cloisonnée par société (voir F11 de l'audit forensique) :
    // jamais accepter un categorieId d'une autre société en devinant/énumérant simplement un id.
    if (categorieId != null) {
      const categorieValide = await prisma.categorieRecette.findFirst({ where: { id: categorieId, societeId } });
      if (!categorieValide) {
        res.status(400).json({ error: "Catégorie invalide" });
        return;
      }
    }

    // Jamais accepter un recetteId d'une autre société en devinant/énumérant simplement un id
    // (même principe que categorieId ci-dessus) — voir le commentaire de
    // recettesAppartiennentALaSociete en tête de fichier.
    const recetteIds = [...new Set((lignes ?? []).map((ligne) => ligne.recetteId))];
    if (!(await recettesAppartiennentALaSociete(recetteIds, societeId))) {
      res.status(400).json({ error: "Une ou plusieurs recettes sont invalides" });
      return;
    }

    // calculerCoutMenu doit être appelé DANS la même transaction que l'écriture, pour la même
    // raison et avec le même correctif que server/routes/recettes.ts (voir son commentaire) :
    // avant ce correctif, l'appel avait lieu après prisma.menu.create — une exception levée par ce
    // calcul laissait malgré tout le menu committé en base, alors que le client recevait un 500
    // "impossible de créer le menu" (faux négatif de succès, voir le rapport RED dédié).
    const menu = await prisma.$transaction(async (tx) => {
      const cree = await tx.menu.create({
        data: {
          nom,
          description: description ?? null,
          categorieId: categorieId ?? null,
          societeId,
          prixVenteHT: prixVenteHT ?? null,
          lignes: {
            create: (lignes ?? []).map((ligne, index) => ({
              recetteId: ligne.recetteId,
              quantite: ligne.quantite,
              ordre: index,
            })),
          },
        },
        include: inclusionsMenu,
      });

      return calculerCoutMenu(cree);
    });

    res.status(201).json(menu);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de créer le menu", req);
  }
});

// Mise à jour d'un menu (les lignes sont remplacées intégralement)
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    // Un id non numérique (NaN) ou numérique mais hors des bornes INT4 réellement utilisées par
    // la colonne `id` (voir ID_POSTGRES_MIN/MAX ci-dessus) atteignait jusqu'ici directement
    // tx.menu.findFirstOrThrow et y provoquait un 500 (PrismaClientValidationError ou
    // ConnectorError) — jamais interceptée par repondreErreurEcriture. Un id dans ces bornes mais
    // inexistant reste 404 (inchangé).
    if (!Number.isInteger(id) || id < ID_POSTGRES_MIN || id > ID_POSTGRES_MAX) {
      res.status(400).json({ error: "Identifiant de menu invalide" });
      return;
    }

    const analyse = schemaModificationMenu.safeParse(req.body);
    if (!analyse.success) {
      res.status(400).json({ error: "Menu invalide", details: analyse.error.flatten() });
      return;
    }
    const { nom, description, categorieId, prixVenteHT, lignes } = analyse.data;

    // CategorieRecette est désormais cloisonnée par société (voir F11 de l'audit forensique) :
    // jamais accepter un categorieId d'une autre société en devinant/énumérant simplement un id.
    if (categorieId != null) {
      const categorieValide = await prisma.categorieRecette.findFirst({
        where: { id: categorieId, societeId: req.utilisateur!.societeId },
      });
      if (!categorieValide) {
        res.status(400).json({ error: "Catégorie invalide" });
        return;
      }
    }

    // Même garde-fou qu'à la création (voir POST / ci-dessus) : vérifié AVANT le $transaction, donc
    // avant tout deleteMany/update — un payload contenant une recette étrangère laisse le menu
    // existant strictement inchangé.
    const recetteIds = [...new Set((lignes ?? []).map((ligne) => ligne.recetteId))];
    if (!(await recettesAppartiennentALaSociete(recetteIds, req.utilisateur!.societeId))) {
      res.status(400).json({ error: "Une ou plusieurs recettes sont invalides" });
      return;
    }

    const menu = await prisma.$transaction(async (tx) => {
      // Scopé par société : jamais permettre à un compte de modifier un menu d'une autre société
      // en devinant/énumérant simplement un id (voir la matrice de permissions, server/app.ts).
      await tx.menu.findFirstOrThrow({ where: { id, societeId: req.utilisateur!.societeId } });

      await tx.menuLigne.deleteMany({ where: { menuId: id } });

      const miseAJour = await tx.menu.update({
        where: { id },
        data: {
          nom,
          description: description ?? null,
          categorieId: categorieId ?? null,
          prixVenteHT: prixVenteHT ?? null,
          lignes: {
            create: (lignes ?? []).map((ligne, index) => ({
              recetteId: ligne.recetteId,
              quantite: ligne.quantite,
              ordre: index,
            })),
          },
        },
        include: inclusionsMenu,
      });

      // Même correctif et même raison que POST / ci-dessus (voir son commentaire) : calculerCoutMenu
      // DANS la transaction, pour que Prisma annule aussi le remplacement des lignes déjà effectué
      // si ce calcul échoue.
      return calculerCoutMenu(miseAJour);
    });

    res.json(menu);
  } catch (error) {
    await repondreErreurEcriture(error, res, "Impossible de mettre à jour le menu", req);
  }
});

// Suppression (douce) d'un menu
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const { count } = await prisma.menu.updateMany({
      where: { id, societeId: req.utilisateur!.societeId },
      data: { actif: false },
    });
    if (count === 0) {
      res.status(404).json({ error: "Menu introuvable" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error(error);
    await journaliserErreur(error, "SERVEUR", contexteDepuisRequete(req, 500));
    res.status(500).json({ error: "Impossible de supprimer le menu" });
  }
});

export default router;
