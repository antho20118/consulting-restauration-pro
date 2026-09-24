// Détection de doublon pour la création manuelle d'un article/ingrédient (voir IngredientForm.tsx).
// Volontairement spécifique au domaine ingrédients plutôt qu'une réutilisation des utilitaires de
// correspondance du domaine recettes (src/features/recettes/utils/correspondanceImportExcel.ts) :
// même principe de duplication délibérée déjà appliqué ailleurs dans ce projet entre client et
// domaines qui ne partagent pas de module commun (ex. LIBELLE_UNITE_BASE, seuils food cost).

export type ArticleExistantPourCorrespondance = {
  id: number;
  nom: string;
  reference: string | null;
  actif: boolean;
};

// Normalisation dédiée (accents, casse, espaces) — même convention que le reste du projet
// (comparaison insensible aux accents/casse/espaces), mais implémentation indépendante propre à
// ce domaine.
export function normaliserNomArticle(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Doublon "évident" uniquement, jamais une simple ressemblance : correspondance exacte par
// référence (code produit, fiable et sans ambiguïté) en priorité, puis correspondance exacte par
// nom normalisé. Contrairement au rapprochement de l'import listing (server/utils/importListing.ts,
// similarité de Jaccard), aucune correspondance floue ici — la création manuelle ne doit jamais
// bloquer à tort la saisie d'un ingrédient réellement différent qui ressemblerait seulement à un
// autre (ex. « Farine » ne doit jamais signaler un doublon avec « Farine de sarrasin »).
//
// Retourne un tableau (0, 1 ou plusieurs candidats) plutôt qu'un seul résultat, pour ne jamais
// choisir silencieusement entre plusieurs articles existants qui partageraient le même nom : c'est
// à l'utilisateur de trancher, jamais au mécanisme de rapprochement.
//
// Les articles inactifs (voir DELETE /articles/:id, suppression douce) sont explicitement exclus
// ici, pas seulement supposés déjà filtrés par l'appelant : un article désactivé ne doit jamais
// bloquer la création d'un nouvel article portant le même nom.
export function trouverArticlesCorrespondants(
  nom: string,
  reference: string,
  articlesExistants: ArticleExistantPourCorrespondance[]
): ArticleExistantPourCorrespondance[] {
  const actifs = articlesExistants.filter((a) => a.actif);

  const refCible = reference.trim().toLowerCase();
  if (refCible) {
    const parReference = actifs.filter(
      (a) => a.reference && a.reference.trim().toLowerCase() === refCible
    );
    if (parReference.length > 0) return parReference;
  }

  const nomCible = normaliserNomArticle(nom);
  if (!nomCible) return [];
  return actifs.filter((a) => normaliserNomArticle(a.nom) === nomCible);
}
