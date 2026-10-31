// Rangement des sauvegardes de la base chez l'hébergeur de stockage (voir sauvegardeExterne.ts).
// L'application ne supprime JAMAIS rien (sa clé d'accès n'en a pas le droit) : la conservation est
// assurée par des règles de cycle de vie configurées chez l'hébergeur, une par dossier —
// voir docs/sauvegarde-restauration.md :
//   base/quotidiennes/  une sauvegarde par nuit, supprimée par l'hébergeur après 35 jours ;
//   base/mensuelles/    la première sauvegarde de chaque mois, supprimée après 25 mois.
// Une clé sans droit de suppression pouvant encore RÉÉCRIRE un fichier existant, l'espace doit avoir
// le versionnage activé chez l'hébergeur (une réécriture garde l'ancienne version) ; l'application,
// elle, n'écrit jamais deux fois sous le même nom (sauvegardes horodatées, documents envoyés une
// seule fois). Les versions anciennes suivent la durée de conservation de leur dossier (documents :
// jamais supprimées). Ainsi, une fuite des clés de l'application ne permet ni d'effacer ni de
// raccourcir l'historique.

export const PREFIXE_BASE = "base/";
export const PREFIXE_QUOTIDIENNES = "base/quotidiennes/";
export const PREFIXE_MENSUELLES = "base/mensuelles/";
export const PREFIXE_DOCUMENTS = "documents/";
export const EXTENSION_CHIFFREE = ".chiffre";
// Durées des règles de cycle de vie à configurer chez l'hébergeur (documentation, affichage).
export const JOURS_CONSERVATION_QUOTIDIENNES = 35;
export const JOURS_CONSERVATION_MENSUELLES = 760;

const NOM_SAUVEGARDE = /^base\/(quotidiennes|mensuelles)\/sauvegarde-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json\.gz\.chiffre$/;

function horodatage(creeLe: Date): string {
  return creeLe.toISOString().replace(/[:.]/g, "-");
}

export function nomQuotidienne(creeLe: Date): string {
  return `${PREFIXE_QUOTIDIENNES}sauvegarde-${horodatage(creeLe)}.json.gz.chiffre`;
}

export function nomMensuelle(creeLe: Date): string {
  return `${PREFIXE_MENSUELLES}sauvegarde-${horodatage(creeLe)}.json.gz.chiffre`;
}

export function dateSauvegardeBase(nom: string): Date | null {
  const m = NOM_SAUVEGARDE.exec(nom);
  if (!m) return null;
  return new Date(`${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}.${m[8]}Z`);
}

// La sauvegarde de ce jour doit-elle AUSSI être rangée dans les mensuelles ? Oui s'il n'en existe
// encore aucune pour ce mois (calendrier UTC, celui des noms de fichiers).
export function mensuelleDue(nomsMensuelles: string[], maintenant: Date): boolean {
  const mois = maintenant.toISOString().slice(0, 7);
  return !nomsMensuelles.some((nom) => dateSauvegardeBase(nom)?.toISOString().slice(0, 7) === mois);
}
