// Saisie faite hors connexion puis synchronisée plus tard (point 9 de l'audit du 15/10) : le
// moment déclaré (dateHeure / dateProduction) est celui de la saisie, createdAt celui de la
// réception par le serveur. Quand ils diffèrent de plus de quelques minutes, les deux sont affichés
// — la traçabilité HACCP montre ainsi qu'une saisie a été transmise en différé, jamais en le
// cachant.
const ECART_SIGNALE_MS = 2 * 60_000;

export function mentionReceptionDifferee(momentDeclare: string, recuLe: string | undefined): string | null {
  if (!recuLe) return null;
  const ecart = new Date(recuLe).getTime() - new Date(momentDeclare).getTime();
  if (!(ecart > ECART_SIGNALE_MS)) return null;
  return `saisi hors connexion, reçu le ${new Date(recuLe).toLocaleString("fr-FR")}`;
}
