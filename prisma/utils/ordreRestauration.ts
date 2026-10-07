// F08 de l'audit forensique : calcule, à partir des relations réelles déclarées dans le schéma
// Prisma (via Prisma.dmmf, jamais une liste recopiée à la main — même principe que
// prisma/sauvegarder.ts pour l'énumération des modèles), l'ordre dans lequel les lignes d'une
// sauvegarde doivent être insérées pour qu'aucune contrainte de clé étrangère ne soit jamais
// violée, ainsi que les relations qui forment un cycle (un modèle qui se référence lui-même).
//
// Les contraintes FK restent actives tout le long de la restauration (jamais de
// `session_replication_role = replica` ni équivalent) : c'est cet ordre, calculé ici, qui rend ça
// possible sans désactiver aucune protection PostgreSQL.

import { Prisma } from "@prisma/client";

export type RelationFK = {
  modele: string;
  champFK: string;
  modeleCible: string;
  optionnelle: boolean;
};

export type GrapheRestauration = {
  // Ordre d'insertion valide pour tous les modèles SAUF ceux impliqués dans une auto-relation
  // (voir autoRelations) : ceux-là s'insèrent en deux passes, à part (voir restaurer.ts).
  ordre: string[];
  // Relations où modeleCible === modele (ex. SousCategorieRecette.parentId) : jamais résolues par
  // le tri topologique, puisqu'aucun ordre linéaire ne peut satisfaire "avant moi-même". Doivent
  // obligatoirement être nullable au niveau FK (sinon la base ne pourrait même pas être peuplée du
  // tout par une suite d'étapes) — vérifié explicitement à la construction, échec immédiat sinon.
  autoRelations: RelationFK[];
  // Cycles entre modèles DISTINCTS (A dépend de B qui dépend de A) : n'existent dans aucune version
  // connue du schéma à ce jour (36/36 modèles s'ordonnent correctement, vérifié). Un cycle ici
  // signifierait qu'aucun ordre d'insertion simple n'existe plus — la restauration doit s'arrêter
  // plutôt que de deviner un ordre partiel.
  cyclesNonResolus: string[][];
};

export class AutoRelationNonNullableError extends Error {}

// Tri topologique de Kahn générique — déterministe (ordre alphabétique à chaque étape à degré
// égal), pour que deux calculs sur le même graphe produisent toujours exactement le même ordre.
// Extrait de construireGrapheRestauration (qui l'utilise avec les relations du DMMF courant) pour
// être réutilisé tel quel par prisma/utils/grapheIntrospection.ts, qui construit un graphe depuis
// le schéma PostgreSQL HISTORIQUE réellement introspecté (voir ce fichier pour le raisonnement
// complet — F08, correctif suite à l'audit indépendant sur les modèles historiques supprimés) :
// jamais deux implémentations parallèles du même algorithme.
//
// `relationsOrdre` : chaque entrée { avant, apres } signifie "avant doit être inséré avant apres"
// (avant est une dépendance de apres — ex. { avant: "Categorie", apres: "Article" }).
export function trierTopologiquement(
  noeuds: string[],
  relationsOrdre: { avant: string; apres: string }[]
): { ordre: string[]; cyclesNonResolus: string[][] } {
  const ensembleNoeuds = new Set(noeuds);
  const dependances = new Map<string, Set<string>>();
  for (const n of ensembleNoeuds) dependances.set(n, new Set());
  for (const { avant, apres } of relationsOrdre) {
    if (!ensembleNoeuds.has(avant) || !ensembleNoeuds.has(apres)) continue;
    dependances.get(apres)!.add(avant);
  }

  const dependants = new Map<string, string[]>();
  for (const n of ensembleNoeuds) dependants.set(n, []);
  const degre = new Map<string, number>();
  for (const n of ensembleNoeuds) degre.set(n, dependances.get(n)!.size);
  for (const [n, deps] of dependances) {
    for (const d of deps) dependants.get(d)!.push(n);
  }
  for (const liste of dependants.values()) liste.sort();

  const file = [...ensembleNoeuds].filter((n) => degre.get(n) === 0).sort();
  const ordre: string[] = [];
  const degreRestant = new Map(degre);
  while (file.length > 0) {
    const n = file.shift()!;
    ordre.push(n);
    for (const dep of dependants.get(n)!) {
      degreRestant.set(dep, degreRestant.get(dep)! - 1);
      if (degreRestant.get(dep) === 0) {
        // Insertion triée pour garder la file déterministe (évite d'avoir à re-trier à chaque tour).
        const idx = file.findIndex((x) => x > dep);
        if (idx === -1) file.push(dep);
        else file.splice(idx, 0, dep);
      }
    }
  }

  const cyclesNonResolus: string[][] = [];
  if (ordre.length !== ensembleNoeuds.size) {
    const restants = [...ensembleNoeuds].filter((n) => !ordre.includes(n)).sort();
    cyclesNonResolus.push(restants);
  }

  return { ordre, cyclesNonResolus };
}

export function construireGrapheRestauration(): GrapheRestauration {
  const modeles = Prisma.dmmf.datamodel.models;
  const nomsModeles = modeles.map((m) => m.name);
  const nomsModelesSet = new Set(nomsModeles);

  const relations: RelationFK[] = [];
  for (const modele of modeles) {
    for (const champ of modele.fields) {
      // Seul le côté "possesseur" d'une relation porte relationFromFields (le côté inverse, ex.
      // "enfants" sur SousCategorieRecette, a relationFromFields: [] et isList: true) — c'est lui
      // qui correspond à une vraie colonne FK et donc à une contrainte d'insertion réelle.
      if (champ.kind !== "object" || !champ.relationFromFields || champ.relationFromFields.length === 0) {
        continue;
      }
      const cible = champ.type;
      if (!nomsModelesSet.has(cible)) continue;

      relations.push({
        modele: modele.name,
        champFK: champ.relationFromFields[0],
        modeleCible: cible,
        optionnelle: !champ.isRequired,
      });
    }
  }

  const autoRelations = relations.filter((r) => r.modeleCible === r.modele);
  for (const r of autoRelations) {
    if (!r.optionnelle) {
      throw new AutoRelationNonNullableError(
        `${r.modele}.${r.champFK} est une auto-relation non nullable : aucune suite d'insertions ne peut jamais la satisfaire (un premier enregistrement n'a par construction aucun prédécesseur à référencer). Le schéma doit rendre cette FK optionnelle, ou cette restauration n'est pas possible telle quelle.`
      );
    }
  }

  const relationsOrdre = relations
    .filter((r) => r.modeleCible !== r.modele)
    .map((r) => ({ avant: r.modeleCible, apres: r.modele }));
  const { ordre, cyclesNonResolus } = trierTopologiquement(nomsModeles, relationsOrdre);

  return { ordre, autoRelations, cyclesNonResolus };
}
