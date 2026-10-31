// Quand faire la sauvegarde de la nuit (voir planificateur.ts) : une par jour (calendrier de Paris),
// à partir de 3 h — heure creuse en restauration —, et rattrapée dès que possible si elle a été
// manquée (serveur arrêté, déploiement, panne). Jamais deux le même jour.

export const HEURE_SAUVEGARDE_PARIS = 3;

const FORMAT_PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function enHeureDeParis(date: Date): { jour: string; heure: number } {
  const parties = Object.fromEntries(FORMAT_PARIS.formatToParts(date).map((p) => [p.type, p.value]));
  return { jour: `${parties.year}-${parties.month}-${parties.day}`, heure: Number(parties.hour) };
}

export function doitSauvegarder(maintenant: Date, derniere: Date | null): boolean {
  if (derniere === null) return true;
  const ici = enHeureDeParis(maintenant);
  if (enHeureDeParis(derniere).jour === ici.jour) return false;
  // Jour suivant la dernière sauvegarde : on attend 3 h. Nuit(s) manquée(s) : tout de suite.
  const veille = enHeureDeParis(new Date(maintenant.getTime() - 86400_000)).jour;
  return ici.heure >= HEURE_SAUVEGARDE_PARIS || enHeureDeParis(derniere).jour < veille;
}
