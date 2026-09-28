// Script de fusion ponctuel : consolide des fiches Fournisseur en doublon (même fournisseur
// physique réel, saisi plusieurs fois en base) sous UNE SEULE fiche « conservée », en réassignant
// tout ce qui référence les fiches absorbées (TarifArticle, ProduitFournisseur,
// DocumentFournisseur), sans jamais supprimer physiquement une ligne : les fiches absorbées sont
// désactivées et renommées avec un marqueur explicite, jamais effacées (l'historique reste
// consultable).
//
// Groupes à fusionner : définis explicitement ci-dessous (GROUPES_A_FUSIONNER), jamais devinés par
// similarité de nom — voir cadrage : décision humaine explicite sur quelle fiche conserver, faite
// après audit des données réelles (nombre de tarifs, tarifs actifs, produits, documents par fiche).
//
// Point critique géré explicitement (voir invariant applicatif "un seul tarif actif par (article,
// fournisseur)", jamais une contrainte SQL — voir TarifArticle dans schema.prisma) : si un même
// article a un tarif actif à la fois sous la fiche conservée et sous une fiche absorbée, les deux
// se retrouveraient, après réassignation brute, avec le même fournisseurId ET actif=true — cassant
// cet invariant partout où le code l'utilise (cleTarifActif, map tarifActifParArticleFournisseur).
// Ce script détecte ces collisions AVANT toute réassignation et ne garde actif que le tarif le plus
// récent (dateDebut la plus tardive), historise (actif:false, dateFin:now()) tous les autres —
// jamais un choix arbitraire par ordre de lecture.
//
// Idempotent : une fiche déjà absorbée (actif:false, nom déjà préfixé du marqueur) n'est jamais
// retraitée par une seconde exécution — vérifié explicitement avant d'agir, jamais supposé.
//
// Usage : npx tsx prisma/fusionnerDoublonsFournisseurs.ts
//         (ou npm run db:fusionner-doublons-fournisseurs)

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const MARQUEUR_FUSIONNE = "[FUSIONNÉ]";

export type GroupeFusion = { conserverId: number; absorberIds: number[]; libelle: string };

// Décidé explicitement avec l'utilisateur après audit des données réelles (voir conversation) :
// Super U -> conserve FOU-0005 (id 5, le plus de tarifs actifs cohérents) ; VIBEL -> conserve
// FOU-0007 (id 7). Ne pas modifier ces ids sans un nouvel audit + une nouvelle décision explicite.
const GROUPES_A_FUSIONNER: GroupeFusion[] = [
  { conserverId: 5, absorberIds: [2, 4, 6, 9], libelle: "Super U" },
  { conserverId: 7, absorberIds: [1], libelle: "VIBEL" },
];

export async function fusionnerGroupe(groupe: GroupeFusion) {
  console.log(`\n=== Fusion ${groupe.libelle} : conserve #${groupe.conserverId}, absorbe [${groupe.absorberIds.join(", ")}] ===`);

  const conserver = await prisma.fournisseur.findUniqueOrThrow({ where: { id: groupe.conserverId } });
  const absorbes = await prisma.fournisseur.findMany({ where: { id: { in: groupe.absorberIds } } });

  if (absorbes.length !== groupe.absorberIds.length) {
    const trouves = absorbes.map((f) => f.id);
    const manquants = groupe.absorberIds.filter((id) => !trouves.includes(id));
    throw new Error(`Fournisseur(s) introuvable(s) pour la fusion "${groupe.libelle}" : ${manquants.join(", ")}`);
  }
  for (const f of absorbes) {
    if (f.societeId !== conserver.societeId) {
      throw new Error(
        `Fournisseur #${f.id} n'appartient pas à la même société que la fiche conservée #${conserver.id} — fusion refusée, vérification manuelle requise.`
      );
    }
  }

  // Idempotence : une fiche déjà absorbée (marqueur déjà présent ET déjà inactive) est ignorée,
  // jamais refusionnée ni renommée deux fois.
  const idsDejaAbsorbes = absorbes.filter((f) => !f.actif && f.nom.startsWith(MARQUEUR_FUSIONNE)).map((f) => f.id);
  const idsAFusionner = groupe.absorberIds.filter((id) => !idsDejaAbsorbes.includes(id));

  if (idsAFusionner.length === 0) {
    console.log(`  Déjà entièrement fusionné (idempotent) — rien à faire.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const tousLesIds = [groupe.conserverId, ...idsAFusionner];

    // --- 1. Résolution des collisions de tarifs actifs AVANT toute réassignation ---
    const tarifs = await tx.tarifArticle.findMany({
      where: { fournisseurId: { in: tousLesIds } },
      select: { id: true, articleId: true, actif: true, dateDebut: true },
    });

    const tarifsActifsParArticle = new Map<number, { id: number; dateDebut: Date }[]>();
    for (const t of tarifs) {
      if (!t.actif) continue;
      const liste = tarifsActifsParArticle.get(t.articleId) ?? [];
      liste.push({ id: t.id, dateDebut: t.dateDebut });
      tarifsActifsParArticle.set(t.articleId, liste);
    }

    let collisionsResolues = 0;
    for (const [, actifsPourArticle] of tarifsActifsParArticle) {
      if (actifsPourArticle.length <= 1) continue;
      actifsPourArticle.sort((a, b) => b.dateDebut.getTime() - a.dateDebut.getTime());
      const [, ...aFermer] = actifsPourArticle;
      await tx.tarifArticle.updateMany({
        where: { id: { in: aFermer.map((t) => t.id) } },
        data: { actif: false, dateFin: new Date() },
      });
      collisionsResolues += aFermer.length;
    }
    if (collisionsResolues > 0) {
      console.log(`  ${collisionsResolues} tarif(s) actif(s) en collision historisé(s) (le plus récent gardé actif).`);
    }

    // --- 2. Réassignation des tarifs (désormais sans collision possible) ---
    const resultatTarifs = await tx.tarifArticle.updateMany({
      where: { fournisseurId: { in: idsAFusionner } },
      data: { fournisseurId: groupe.conserverId },
    });
    console.log(`  ${resultatTarifs.count} tarif(s) réassigné(s) vers #${groupe.conserverId}.`);

    // --- 3. Réassignation des produits fournisseur, avec détection explicite de collision de code
    // (contrainte @@unique([fournisseurId, codeProduitFournisseur])) : jamais un écrasement
    // silencieux, le script s'arrête et signale si un même code existe déjà côté fiche conservée. ---
    const produitsAAbsorber = await tx.produitFournisseur.findMany({ where: { fournisseurId: { in: idsAFusionner } } });
    for (const p of produitsAAbsorber) {
      const collision = await tx.produitFournisseur.findUnique({
        where: { fournisseurId_codeProduitFournisseur: { fournisseurId: groupe.conserverId, codeProduitFournisseur: p.codeProduitFournisseur } },
      });
      if (collision) {
        throw new Error(
          `Collision de code produit fournisseur "${p.codeProduitFournisseur}" entre la fiche conservée #${groupe.conserverId} et la fiche absorbée #${p.fournisseurId} — fusion arrêtée, décision manuelle requise pour ce code.`
        );
      }
    }
    const resultatProduits = await tx.produitFournisseur.updateMany({
      where: { fournisseurId: { in: idsAFusionner } },
      data: { fournisseurId: groupe.conserverId },
    });
    if (resultatProduits.count > 0) {
      console.log(`  ${resultatProduits.count} produit(s) fournisseur réassigné(s) vers #${groupe.conserverId}.`);
    }

    // --- 4. Réassignation des documents (aucune contrainte d'unicité, jamais de collision possible) ---
    const resultatDocuments = await tx.documentFournisseur.updateMany({
      where: { fournisseurId: { in: idsAFusionner } },
      data: { fournisseurId: groupe.conserverId },
    });
    if (resultatDocuments.count > 0) {
      console.log(`  ${resultatDocuments.count} document(s) réassigné(s) vers #${groupe.conserverId}.`);
    }

    // --- 5. Désactivation + marquage des fiches absorbées (jamais de suppression physique : la
    // fiche reste consultable et son historique de création n'est jamais perdu). ---
    for (const id of idsAFusionner) {
      const fournisseur = absorbes.find((f) => f.id === id)!;
      await tx.fournisseur.update({
        where: { id },
        data: { actif: false, nom: `${MARQUEUR_FUSIONNE} ${fournisseur.nom} -> voir #${groupe.conserverId}` },
      });
    }
    console.log(`  ${idsAFusionner.length} fiche(s) absorbée(s) désactivée(s) et marquée(s).`);
  });
}

async function main() {
  for (const groupe of GROUPES_A_FUSIONNER) {
    await fusionnerGroupe(groupe);
  }
  console.log("\n✅ Fusion terminée.");
}

// Ne lance la fusion réelle QUE si ce fichier est exécuté directement (npx tsx ... / npm run
// db:fusionner-doublons-fournisseurs) — jamais quand il est simplement importé pour réutiliser
// fusionnerGroupe/MARQUEUR_FUSIONNE (voir tests), ce qui exécuterait sinon une fusion réelle avec
// les ids de production codés en dur à chaque import, y compris dans un contexte de test local.
const executeDirectement = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (executeDirectement) {
  main()
    .catch((e) => {
      console.error("\n❌ Fusion interrompue :", e instanceof Error ? e.message : e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
