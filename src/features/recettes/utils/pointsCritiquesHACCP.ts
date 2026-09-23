// Points critiques HACCP standards proposés dans le sélecteur de contrôle d'une étape (voir
// RecetteForm.tsx) : une liste fixe et validée par le métier, pour choisir le libellé approprié
// plutôt que de le retaper à chaque fois. Le champ reste éditable ensuite pour l'ajuster au cas
// particulier de la recette.
export const POINTS_CRITIQUES_HACCP: { titre: string; description: string }[] = [
  {
    titre: "Traitement des légumes",
    description: "Laver, décontaminer selon le protocole en vigueur et rincer à l'eau potable.",
  },
  {
    titre: "Préparation",
    description: "Utiliser du matériel propre et désinfecté. Éviter toute contamination croisée.",
  },
  {
    titre: "Cuisson",
    description: "Atteindre et contrôler la température à cœur définie par le procédé validé.",
  },
  {
    titre: "Refroidissement",
    description: "Refroidir de +63 °C à < +10 °C en moins de 2 heures.",
  },
  {
    titre: "Stockage",
    description: "Conserver à ≤ +3 °C.",
  },
  {
    titre: "Conditionnement",
    description: "Conditionner après refroidissement conforme. Vérifier l'intégrité du conditionnement.",
  },
  {
    titre: "Décongélation",
    description: "Décongeler exclusivement en enceinte réfrigérée.",
  },
  {
    titre: "Remise en température",
    description: "Passer de +10 °C à ≥ +63 °C en moins d'1 heure.",
  },
  {
    titre: "Maintien chaud",
    description: "Maintenir à ≥ +63 °C jusqu'au service.",
  },
  {
    titre: "Service",
    description: "Limiter le temps hors température contrôlée et respecter les conditions de conservation.",
  },
];
