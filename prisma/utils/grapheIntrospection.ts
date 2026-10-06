// F08 de l'audit forensique — correctif suite à l'audit indépendant : construit le graphe de
// restauration (ordre d'insertion, auto-relations, cycles) depuis le schéma PostgreSQL HISTORIQUE
// réellement introspecté (voir introspectionSchema.ts), pas depuis le DMMF courant. C'est ce qui
// permet au tri de respecter le graphe de dépendances tel qu'il existait réellement au moment du
// backup — y compris pour une table depuis supprimée (ex. AccesApplication) — plutôt que de
// supposer que le graphe courant et le graphe historique sont toujours identiques.
//
// Réutilise trierTopologiquement (prisma/utils/ordreRestauration.ts) tel quel : même algorithme
// que pour le graphe DMMF, jamais une seconde implémentation parallèle du tri.

import { trierTopologiquement, AutoRelationNonNullableError, type RelationFK, type GrapheRestauration } from "./ordreRestauration.js";
import type { SchemaIntrospecte } from "./introspectionSchema.js";

export function construireGrapheDepuisIntrospection(schema: SchemaIntrospecte): GrapheRestauration {
  const nomsTables = [...schema.tables.keys()];

  const relations: RelationFK[] = schema.relations.map((r) => ({
    modele: r.table,
    champFK: r.colonne,
    modeleCible: r.tableCible,
    optionnelle: r.optionnelle,
  }));

  const autoRelations = relations.filter((r) => r.modeleCible === r.modele);
  for (const r of autoRelations) {
    if (!r.optionnelle) {
      throw new AutoRelationNonNullableError(
        `${r.modele}.${r.champFK} est une auto-relation non nullable dans le schéma historique restauré : aucune suite d'insertions ne peut jamais la satisfaire. Restauration impossible telle quelle.`
      );
    }
  }

  const relationsOrdre = relations
    .filter((r) => r.modeleCible !== r.modele)
    .map((r) => ({ avant: r.modeleCible, apres: r.modele }));
  const { ordre, cyclesNonResolus } = trierTopologiquement(nomsTables, relationsOrdre);

  return { ordre, autoRelations, cyclesNonResolus };
}
