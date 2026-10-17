// Préchargement des lectures consultables sans réseau (fiches recettes, menus, productions,
// évaluation HACCP) : jusqu'ici, seule une fiche déjà ouverte au moins une fois sur l'appareil
// était lisible hors connexion. Chaque réponse chargée ici passe par le service worker, dont le
// cache « lectures-hors-ligne » (voir vite.config.ts, runtimeCaching) la conserve — exactement les
// mêmes adresses que celles appelées par les pages, donc retrouvées telles quelles hors connexion.
//
// Logique pure (chargeur injecté) pour rester testable sans navigateur ni service worker — voir
// tests/unit/prechargementLectures.test.ts ; l'adaptateur réel est demarrerPrechargementLectures.

export type Chargeur = (chemin: string) => Promise<unknown>;

export type BilanPrechargement = { chargees: number; echecs: number };

// Quelques requêtes à la fois, jamais toutes d'un coup : une carte de plusieurs centaines de
// recettes ne doit ni saturer le serveur ni la connexion du téléphone.
const PARALLELISME = 4;

export async function prechargerLectures(charger: Chargeur): Promise<BilanPrechargement> {
  const bilan: BilanPrechargement = { chargees: 0, echecs: 0 };

  async function essayer(chemin: string): Promise<unknown> {
    try {
      const corps = await charger(chemin);
      bilan.chargees++;
      return corps;
    } catch {
      // Une fiche manquée reste simplement non disponible hors connexion (elle le deviendra à sa
      // prochaine ouverture en ligne) — jamais une raison d'interrompre les autres.
      bilan.echecs++;
      return null;
    }
  }

  const [recettes] = await Promise.all(
    ["/recettes", "/menus", "/productions", "/categories-recette", "/sous-categories-recette", "/depots"].map(essayer)
  );
  const ids = Array.isArray(recettes)
    ? recettes.map((r) => (r as { id?: unknown }).id).filter((id): id is number => typeof id === "number")
    : [];
  const chemins = ids.flatMap((id) => [`/recettes/${id}`, `/haccp/evaluer/${id}`]);

  let prochain = 0;
  async function ouvrier() {
    while (prochain < chemins.length) {
      const chemin = chemins[prochain++];
      await essayer(chemin);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLELISME, chemins.length) }, ouvrier));

  return bilan;
}

// Un préchargement par service suffit : relancé seulement si le dernier réussi, pour ce même compte,
// a plus de 12 heures — jamais à chaque ouverture de l'application (une carte de 200 recettes, ce
// sont ~400 requêtes sur le forfait mobile du cuisinier). Un autre compte sur le même appareil
// (cache purgé à la déconnexion) relance toujours le sien.
export const INTERVALLE_PRECHARGEMENT_MS = 12 * 3600_000;

export type DernierPrechargement = { le: number; utilisateurId: number };

export function prechargementNecessaire(
  dernier: DernierPrechargement | null,
  utilisateurId: number,
  maintenant: number
): boolean {
  if (!dernier || dernier.utilisateurId !== utilisateurId) return true;
  return maintenant - dernier.le >= INTERVALLE_PRECHARGEMENT_MS || maintenant < dernier.le;
}
