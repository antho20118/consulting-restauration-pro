import { nettoyerTitre } from "./analyserFichierTechniques";

// Contrairement à trouverRecetteCorrespondante (analyserFichierTechniques.ts), qui retourne le
// meilleur candidat unique pour ajouter des étapes sans jamais bloquer l'utilisateur, l'import
// Excel sécurisé doit au contraire pouvoir DÉTECTER une ambiguïté et la signaler plutôt que de
// choisir à la place de l'utilisateur (voir CAS C dans ImporterRecettesExcelSecuriseModal.tsx) :
// cette fonction retourne donc tous les candidats, jamais un seul.
export type RecetteExistantePourCorrespondance = { id: number; nom: string; actif: boolean };

// CAS A/B/C : 0 candidat -> création, 1 candidat -> mise à jour, 2+ candidats -> ambiguïté à
// résoudre manuellement. Prend en compte les recettes actives ET inactives (une recette inactive
// doit pouvoir être reconnue et mise à jour, sans jamais être réactivée automatiquement — voir
// server/routes/recettes.ts, POST /import-excel, qui ne touche jamais au champ `actif`).
export function trouverToutesCorrespondances(
  titre: string,
  recettes: RecetteExistantePourCorrespondance[]
): RecetteExistantePourCorrespondance[] {
  const cible = nettoyerTitre(titre);
  if (!cible) return [];

  // Une correspondance exacte est toujours prioritaire sur une correspondance par inclusion, mais
  // s'il existe plusieurs recettes strictement homonymes (aucune contrainte d'unicité sur `nom`
  // en base), c'est encore une ambiguïté réelle, jamais un choix arbitraire entre les deux.
  const exactes = recettes.filter((r) => nettoyerTitre(r.nom) === cible);
  if (exactes.length > 0) return exactes;

  return recettes.filter((r) => {
    const nom = nettoyerTitre(r.nom);
    // Un nom vide (recette mal nommée) "inclut" et est "inclus dans" n'importe quelle chaîne :
    // sans cette garde, il correspondrait à tort à toutes les recettes du fichier (même défaut
    // que trouverRecetteCorrespondante, dont cette fonction reprend le principe).
    if (!nom) return false;
    return nom.includes(cible) || cible.includes(nom);
  });
}

// CAS D : détecte les titres en doublon à l'intérieur même du fichier importé (ex. "RATATOUILLE"
// présent dans deux onglets avec des compositions différentes). Retourne, pour chaque titre
// normalisé apparaissant plus d'une fois, la liste des index (dans le tableau `recettes` fourni)
// concernés — jamais fusionnés, chaque occurrence devant être décidée individuellement par
// l'utilisateur dans l'aperçu.
export function detecterDoublonsInternes(
  recettes: { titre: string }[]
): Map<string, number[]> {
  const parTitre = new Map<string, number[]>();

  recettes.forEach((recette, index) => {
    const cle = nettoyerTitre(recette.titre);
    if (!cle) return;
    if (!parTitre.has(cle)) parTitre.set(cle, []);
    parTitre.get(cle)!.push(index);
  });

  const doublons = new Map<string, number[]>();
  for (const [cle, indices] of parTitre) {
    if (indices.length > 1) doublons.set(cle, indices);
  }
  return doublons;
}

// Statut calculé pour une recette du fichier, combinant CAS A/B/C (correspondance) et CAS D
// (doublon interne) — le doublon interne prime : tant qu'une occurrence en doublon n'a pas été
// résolue explicitement par l'utilisateur (voir ImporterRecettesExcelSecuriseModal.tsx), sa
// correspondance avec une recette existante n'est pas évaluée, pour ne jamais laisser un cas D se
// résoudre silencieusement en cas A.
export type StatutRecetteImport =
  | { type: "doublon_interne"; indicesLies: number[] }
  | { type: "creation" }
  | { type: "mise_a_jour"; recette: RecetteExistantePourCorrespondance }
  | { type: "ambiguite"; candidats: RecetteExistantePourCorrespondance[] };

export function classifierRecetteImport(
  index: number,
  titre: string,
  doublonsInternes: Map<string, number[]>,
  recettesExistantes: RecetteExistantePourCorrespondance[]
): StatutRecetteImport {
  const cle = nettoyerTitre(titre);
  const groupe = doublonsInternes.get(cle);
  if (groupe && groupe.includes(index)) {
    return { type: "doublon_interne", indicesLies: groupe };
  }

  const candidats = trouverToutesCorrespondances(titre, recettesExistantes);
  if (candidats.length === 0) return { type: "creation" };
  if (candidats.length === 1) return { type: "mise_a_jour", recette: candidats[0] };
  return { type: "ambiguite", candidats };
}
