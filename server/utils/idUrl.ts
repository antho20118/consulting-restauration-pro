// Bornes de la colonne `id` (Int Prisma = INT4 Postgres). Mêmes valeurs que celles déjà déclarées
// localement dans articles.ts, menus.ts et depots.ts (non modifiés par ce chantier).
export const ID_POSTGRES_MIN = -2147483648;
export const ID_POSTGRES_MAX = 2147483647;

// Contrôle d'un id lu dans l'URL par Number(req.params.id), à faire AVANT tout appel Prisma :
//   - "abc" donne NaN, que Prisma refuse en PrismaClientValidationError (500 générique) ;
//   - un entier hors INT4 atteint le driver Postgres et échoue aussi en 500 ;
//   - surtout, un DÉCIMAL ("12.5") n'est pas refusé par Prisma : il est tronqué et la requête
//     s'applique réellement à la ligne 12 (constaté sur les référentiels, voir
//     tests/unit/referentielsIdsUrl.test.ts).
// Les trois cas sont des erreurs de saisie du client (400), jamais une panne.
export function idUrlValide(id: number): boolean {
  return Number.isInteger(id) && id >= ID_POSTGRES_MIN && id <= ID_POSTGRES_MAX;
}
